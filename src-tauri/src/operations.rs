use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use libpna::{
    Archive, Chunk, ChunkType, EntryBuilder, EntryName, NormalEntry, PermissionMode, RawChunk,
    WriteOptions,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn plaintext_digest_chunk_type() -> ChunkType {
    ChunkType::private(*b"phSh").expect("the PNA GUI digest chunk type is valid")
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CreateCompression {
    Store,
    Deflate,
    Zstd,
    Xz,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CreateEncryption {
    None,
    Aes,
    Camellia,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOptions {
    pub solid: bool,
    pub compression: CreateCompression,
    pub encryption: CreateEncryption,
    pub password: Option<String>,
    pub preserve_permissions: bool,
    #[serde(default)]
    pub reproducible: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub sources: Vec<PathBuf>,
    pub output_path: PathBuf,
    pub overwrite: bool,
    pub options: CreateOptions,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationOutcome {
    pub output_path: PathBuf,
    pub completed_items: u64,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictPolicy {
    Ask,
    Overwrite,
    Skip,
    Rename,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRequest {
    pub archive_path: PathBuf,
    pub destination: PathBuf,
    #[serde(default)]
    pub entries: Vec<PathBuf>,
    pub password: Option<String>,
    pub conflict: ConflictPolicy,
    pub restore_permissions: bool,
    pub keep_completed_on_cancel: bool,
}

pub fn extract_archive<C, P>(
    request: &ExtractRequest,
    cancelled: C,
    mut progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    if request.destination.as_os_str().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "an extraction destination is required",
        ));
    }
    fs::create_dir_all(&request.destination)?;
    let canonical_destination = fs::canonicalize(&request.destination)?;
    let root_name = request
        .archive_path
        .file_stem()
        .unwrap_or_else(|| std::ffi::OsStr::new("pna"));
    let root_relative = super::safe_relative_entry_path(Path::new(root_name))?;
    super::create_safe_directory(&request.destination, &canonical_destination, &root_relative)?;
    let root = request.destination.join(root_relative);
    let canonical_root = fs::canonicalize(&root)?;

    let (total, required_bytes) = preflight_extract(request)?;
    ensure_space(required_bytes, fs2::available_space(&request.destination)?)?;
    let file = fs::File::open(&request.archive_path)?;
    let mut archive = Archive::read_header(file)?;
    let mut completed = Vec::new();
    let mut completed_units = 0_u64;
    let mut warnings = Vec::new();
    let password = request.password.as_deref();

    let result = (|| -> io::Result<()> {
        for entry in archive.entries_with_password(password.map(str::as_bytes)) {
            check_cancelled(&cancelled)?;
            let entry = entry?;
            let name = entry.header().path().as_path();
            let relative = super::safe_relative_entry_path(name)?;
            if !is_selected(&relative, &request.entries) {
                continue;
            }
            match entry.header().data_kind() {
                libpna::DataKind::Directory => {
                    super::create_safe_directory(&root, &canonical_root, &relative)?;
                }
                libpna::DataKind::File => {
                    let parent = relative.parent().unwrap_or_else(|| Path::new("."));
                    super::create_safe_directory(&root, &canonical_root, parent)?;
                    let requested_path = root.join(&relative);
                    let target = resolve_conflict(&requested_path, request.conflict)?;
                    if let Some(target) = target {
                        reject_non_regular_destination(&target)?;
                        let partial = unique_sibling_path(&target, "partial")?;
                        let mut partial_guard = PartialFile::new(partial.clone());
                        let mut writer = OpenOptions::new()
                            .write(true)
                            .create_new(true)
                            .open(&partial)?;
                        let mut reader =
                            entry.reader(libpna::ReadOptions::with_password(password))?;
                        let expected_digest = entry
                            .extra_chunks()
                            .iter()
                            .find(|chunk| chunk.ty() == plaintext_digest_chunk_type())
                            .map(|chunk| chunk.data().to_vec());
                        if expected_digest.is_none()
                            && entry.header().encryption() != libpna::Encryption::No
                            && entry.header().compression() == libpna::Compression::No
                        {
                            return Err(io::Error::new(
                                io::ErrorKind::PermissionDenied,
                                "the encrypted uncompressed entry has no plaintext integrity metadata, so its password cannot be verified safely",
                            ));
                        }
                        let mut digest = Sha256::new();
                        let mut buffer = [0_u8; 64 * 1024];
                        loop {
                            check_cancelled(&cancelled)?;
                            let read = std::io::Read::read(&mut reader, &mut buffer)?;
                            if read == 0 {
                                break;
                            }
                            writer.write_all(&buffer[..read])?;
                            digest.update(&buffer[..read]);
                        }
                        if let Some(expected_digest) = expected_digest {
                            if digest.finalize().as_slice() != expected_digest {
                                return Err(io::Error::new(
                                    io::ErrorKind::PermissionDenied,
                                    "the archive password is incorrect or the encrypted entry failed its integrity check",
                                ));
                            }
                        }
                        writer.sync_all()?;
                        check_cancelled(&cancelled)?;
                        warnings.extend(commit_output(&partial, &target, target.exists())?);
                        partial_guard.commit();
                        restore_permissions(
                            &target,
                            entry.metadata(),
                            request.restore_permissions,
                        )?;
                        completed.push(target);
                    }
                    completed_units += 1;
                    progress(completed_units, total, &relative.to_string_lossy());
                }
                libpna::DataKind::SymbolicLink | libpna::DataKind::HardLink => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "archive links are not extracted",
                    ));
                }
                libpna::DataKind::Reserved(_) | libpna::DataKind::Private(_) => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "unsupported archive entry kind",
                    ));
                }
            }
        }
        Ok(())
    })();

    if let Err(error) = result {
        if cancelled() && !request.keep_completed_on_cancel {
            for path in completed.iter().rev() {
                let _ = fs::remove_file(path);
            }
        }
        return Err(error);
    }

    Ok(OperationOutcome {
        output_path: root,
        completed_items: completed_units,
        warnings,
    })
}

fn preflight_extract(request: &ExtractRequest) -> io::Result<(u64, u128)> {
    let encrypted = crate::utils::is_encrypted(&request.archive_path)?;
    if encrypted && request.password.as_deref().unwrap_or_default().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "a password is required for the encrypted archive",
        ));
    }
    let file = fs::File::open(&request.archive_path)?;
    let mut archive = Archive::read_header(file)?;
    let password = request.password.as_deref();
    let mut files = 0_u64;
    let mut required_bytes = 0_u128;
    for entry in archive.entries_with_password(password.map(str::as_bytes)) {
        let entry = entry?;
        let relative = super::safe_relative_entry_path(entry.header().path().as_path())?;
        if !is_selected(&relative, &request.entries) {
            continue;
        }
        match entry.header().data_kind() {
            libpna::DataKind::File => {
                files += 1;
                required_bytes = required_bytes
                    .saturating_add(entry.metadata().raw_file_size().unwrap_or_default());
            }
            libpna::DataKind::Directory => {}
            libpna::DataKind::SymbolicLink | libpna::DataKind::HardLink => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "archive links are not extracted",
                ));
            }
            libpna::DataKind::Reserved(_) | libpna::DataKind::Private(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "unsupported archive entry kind",
                ));
            }
        }
    }
    Ok((files, required_bytes))
}

fn ensure_space(required: u128, available: u64) -> io::Result<()> {
    if required > available as u128 {
        Err(io::Error::new(
            io::ErrorKind::StorageFull,
            format!("extraction requires {required} bytes but only {available} are available"),
        ))
    } else {
        Ok(())
    }
}

fn is_selected(path: &Path, selected: &[PathBuf]) -> bool {
    selected.is_empty()
        || selected
            .iter()
            .any(|selection| path == selection || path.starts_with(selection))
}

fn resolve_conflict(path: &Path, policy: ConflictPolicy) -> io::Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(Some(path.to_path_buf()));
    }
    match policy {
        ConflictPolicy::Ask => Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("destination already exists: {}", path.display()),
        )),
        ConflictPolicy::Overwrite => Ok(Some(path.to_path_buf())),
        ConflictPolicy::Skip => Ok(None),
        ConflictPolicy::Rename => {
            let parent = path.parent().unwrap_or_else(|| Path::new("."));
            let stem = path.file_stem().unwrap_or_default().to_string_lossy();
            let extension = path.extension().map(|value| value.to_string_lossy());
            for suffix in 1..10_000 {
                let name = match &extension {
                    Some(extension) => format!("{stem} ({suffix}).{extension}"),
                    None => format!("{stem} ({suffix})"),
                };
                let candidate = parent.join(name);
                if !candidate.exists() {
                    return Ok(Some(candidate));
                }
            }
            Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "could not allocate a conflict-free destination name",
            ))
        }
    }
}

fn reject_non_regular_destination(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || metadata.is_dir() => {
            Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "destination file is not a regular file",
            ))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn restore_permissions(path: &Path, metadata: &libpna::Metadata, enabled: bool) -> io::Result<()> {
    if !enabled {
        return Ok(());
    }
    #[cfg(unix)]
    if let Some(mode) = metadata.permission_mode() {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode.get() as u32))?;
    }
    Ok(())
}

pub fn create_archive<C, P>(
    request: &CreateRequest,
    cancelled: C,
    mut progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    if request.sources.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "at least one source is required",
        ));
    }
    if !matches!(request.options.encryption, CreateEncryption::None)
        && request
            .options
            .password
            .as_deref()
            .unwrap_or_default()
            .is_empty()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a password is required for encryption",
        ));
    }
    if request.options.reproducible && !matches!(request.options.encryption, CreateEncryption::None)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "reproducible archives cannot be encrypted",
        ));
    }
    if request.output_path.exists() && !request.overwrite {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "the output archive already exists",
        ));
    }

    let parent = request
        .output_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let entries = scan_sources(&request.sources)?;
    let total = entries.len() as u64;
    let partial = unique_sibling_path(&request.output_path, "partial")?;
    let mut partial_guard = PartialFile::new(partial.clone());
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;

    let result = if request.options.solid {
        let options = write_options(&request.options);
        let mut archive = Archive::write_solid_header(file, options)?;
        for (offset, entry) in entries.iter().enumerate() {
            check_cancelled(&cancelled)?;
            archive.add_entry(build_scanned_entry(entry, &request.options)?)?;
            progress(
                offset as u64 + 1,
                total,
                &entry.archive_path.to_string_lossy(),
            );
        }
        archive.finalize()
    } else {
        let mut archive = Archive::write_header(file)?;
        for (offset, entry) in entries.iter().enumerate() {
            check_cancelled(&cancelled)?;
            archive.add_entry(build_scanned_entry(entry, &request.options)?)?;
            progress(
                offset as u64 + 1,
                total,
                &entry.archive_path.to_string_lossy(),
            );
        }
        archive.finalize()
    };

    let file = result?;
    file.sync_all()?;
    check_cancelled(&cancelled)?;
    let warnings = commit_output(&partial, &request.output_path, request.overwrite)?;
    partial_guard.commit();

    Ok(OperationOutcome {
        output_path: request.output_path.clone(),
        completed_items: total,
        warnings,
    })
}

#[derive(Debug)]
struct ScannedEntry {
    source_path: PathBuf,
    archive_path: PathBuf,
    directory: bool,
}

fn scan_sources(sources: &[PathBuf]) -> io::Result<Vec<ScannedEntry>> {
    let mut result = Vec::new();
    let mut names = HashSet::new();
    for source in sources {
        let metadata = fs::symlink_metadata(source)?;
        if metadata.file_type().is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "symbolic link sources are not followed",
            ));
        }
        let root_name = source.file_name().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "source has no portable name")
        })?;
        scan_source(source, PathBuf::from(root_name), &mut result, &mut names)?;
    }
    result.sort_by(|left, right| left.archive_path.cmp(&right.archive_path));
    Ok(result)
}

fn scan_source(
    source: &Path,
    archive_path: PathBuf,
    result: &mut Vec<ScannedEntry>,
    names: &mut HashSet<PathBuf>,
) -> io::Result<()> {
    if !names.insert(archive_path.clone()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("duplicate archive path: {}", archive_path.display()),
        ));
    }
    let metadata = fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "symbolic link sources are not followed",
        ));
    }
    if metadata.is_dir() {
        result.push(ScannedEntry {
            source_path: source.to_path_buf(),
            archive_path: archive_path.clone(),
            directory: true,
        });
        let mut children = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            scan_source(
                &child.path(),
                archive_path.join(child.file_name()),
                result,
                names,
            )?;
        }
    } else if metadata.is_file() {
        result.push(ScannedEntry {
            source_path: source.to_path_buf(),
            archive_path,
            directory: false,
        });
    } else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unsupported source type",
        ));
    }
    Ok(())
}

fn build_scanned_entry(scanned: &ScannedEntry, options: &CreateOptions) -> io::Result<NormalEntry> {
    let name = EntryName::from_lossy(&scanned.archive_path);
    if scanned.directory {
        let mut builder = EntryBuilder::new_dir(name);
        apply_permissions(&mut builder, &scanned.source_path, options)?;
        builder.build()
    } else {
        let mut source = fs::File::open(&scanned.source_path)?;
        let entry_options = if options.solid {
            WriteOptions::store()
        } else {
            write_options(options)
        };
        let mut builder = EntryBuilder::new_file(name, entry_options)?;
        apply_permissions(&mut builder, &scanned.source_path, options)?;
        let mut digest = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = std::io::Read::read(&mut source, &mut buffer)?;
            if read == 0 {
                break;
            }
            builder.write_all(&buffer[..read])?;
            digest.update(&buffer[..read]);
        }
        builder.add_extra_chunk(RawChunk::from_data(
            plaintext_digest_chunk_type(),
            digest.finalize().to_vec(),
        ));
        builder.build()
    }
}

fn write_options(options: &CreateOptions) -> WriteOptions {
    let compression = match options.compression {
        CreateCompression::Store => libpna::Compression::No,
        CreateCompression::Deflate => libpna::Compression::Deflate,
        CreateCompression::Zstd => libpna::Compression::ZStandard,
        CreateCompression::Xz => libpna::Compression::XZ,
    };
    let encryption = match options.encryption {
        CreateEncryption::None => libpna::Encryption::No,
        CreateEncryption::Aes => libpna::Encryption::Aes,
        CreateEncryption::Camellia => libpna::Encryption::Camellia,
    };
    WriteOptions::builder()
        .compression(compression)
        .encryption(encryption)
        .password(options.password.as_ref())
        .build()
}

fn apply_permissions(
    builder: &mut EntryBuilder,
    source: &Path,
    options: &CreateOptions,
) -> io::Result<()> {
    if !options.preserve_permissions {
        return Ok(());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(source)?.permissions().mode() as u16;
        builder.permission_mode(PermissionMode::from(mode));
    }
    Ok(())
}

fn check_cancelled(cancelled: &impl Fn() -> bool) -> io::Result<()> {
    if cancelled() {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "operation cancelled",
        ))
    } else {
        Ok(())
    }
}

fn unique_sibling_path(path: &Path, purpose: &str) -> io::Result<PathBuf> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    for _ in 0..1000 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(
            ".{name}.{purpose}-{}-{sequence}",
            std::process::id()
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a temporary path",
    ))
}

fn commit_output(partial: &Path, output: &Path, overwrite: bool) -> io::Result<Vec<String>> {
    commit_output_with(
        partial,
        output,
        overwrite,
        |from, to| fs::rename(from, to),
        |path| fs::remove_file(path),
    )
}

fn commit_output_with(
    partial: &Path,
    output: &Path,
    overwrite: bool,
    mut rename: impl FnMut(&Path, &Path) -> io::Result<()>,
    mut remove: impl FnMut(&Path) -> io::Result<()>,
) -> io::Result<Vec<String>> {
    if output.exists() {
        if !overwrite {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "the output archive already exists",
            ));
        }
        let backup = unique_sibling_path(output, "backup")?;
        rename(output, &backup)?;
        match rename(partial, output) {
            Ok(()) => {
                let warnings = remove(&backup)
                    .err()
                    .map(|error| {
                        format!(
                            "archive was committed, but the previous archive could not be removed at {}: {error}",
                            backup.display()
                        )
                    })
                    .into_iter()
                    .collect();
                Ok(warnings)
            }
            Err(commit_error) => match rename(&backup, output) {
                Ok(()) => Err(commit_error),
                Err(rollback_error) => Err(io::Error::new(
                    commit_error.kind(),
                    format!(
                        "archive commit failed: {commit_error}; restoring the previous archive also failed: {rollback_error}; the previous archive may still be recovered from {}",
                        backup.display()
                    ),
                )),
            },
        }
    } else {
        rename(partial, output)?;
        Ok(Vec::new())
    }
}

struct PartialFile {
    path: PathBuf,
    committed: bool,
}

impl PartialFile {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for PartialFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{Read, Write},
        sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    };

    use libpna::{Archive, EntryReference, ReadOptions};
    use tempfile::tempdir;

    use super::*;

    fn standard_options() -> CreateOptions {
        CreateOptions {
            solid: false,
            compression: CreateCompression::Zstd,
            encryption: CreateEncryption::None,
            password: None,
            preserve_permissions: true,
            reproducible: false,
        }
    }

    fn write_archive(path: &Path, entries: &[(&str, &[u8])], password: Option<&str>) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        for (name, content) in entries {
            let options = WriteOptions::builder()
                .encryption(if password.is_some() {
                    libpna::Encryption::Aes
                } else {
                    libpna::Encryption::No
                })
                .password(password)
                .build();
            let mut entry = EntryBuilder::new_file(EntryName::from(*name), options).unwrap();
            entry.write_all(content).unwrap();
            entry.add_extra_chunk(RawChunk::from_data(
                plaintext_digest_chunk_type(),
                Sha256::digest(content).to_vec(),
            ));
            archive.add_entry(entry.build().unwrap()).unwrap();
        }
        archive.finalize().unwrap();
    }

    #[test]
    fn creates_a_folder_tree_at_the_final_path_only_after_success() {
        // BE-P2-CREATE-FOLDER-ATOMIC
        let temp = tempdir().unwrap();
        let source = temp.path().join("project");
        fs::create_dir_all(source.join("docs")).unwrap();
        fs::write(source.join("docs/readme.txt"), b"phase two").unwrap();
        let output = temp.path().join("backup.pna");
        let progress = std::sync::Mutex::new(Vec::new());

        let outcome = create_archive(
            &CreateRequest {
                sources: vec![source],
                output_path: output.clone(),
                overwrite: false,
                options: standard_options(),
            },
            || false,
            |completed, total, item| {
                progress
                    .lock()
                    .unwrap()
                    .push((completed, total, item.to_string()));
            },
        )
        .unwrap();

        assert_eq!(outcome.output_path, output);
        assert_eq!(outcome.completed_items, 3);
        assert!(output.exists());
        assert!(fs::read_dir(temp.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("partial")));

        let mut archive = Archive::read_header(fs::File::open(&output).unwrap()).unwrap();
        let mut names = Vec::new();
        let mut content = String::new();
        for entry in archive.entries().map(Result::unwrap) {
            let libpna::ReadEntry::Normal(entry) = entry else {
                panic!("expected a normal entry");
            };
            names.push(entry.header().path().as_path().to_path_buf());
            if entry.header().path().as_path() == std::path::Path::new("project/docs/readme.txt") {
                entry
                    .reader(ReadOptions::builder().build())
                    .unwrap()
                    .read_to_string(&mut content)
                    .unwrap();
            }
        }
        assert!(names.contains(&PathBuf::from("project")));
        assert!(names.contains(&PathBuf::from("project/docs")));
        assert!(names.contains(&PathBuf::from("project/docs/readme.txt")));
        assert_eq!(content, "phase two");
        assert_eq!(progress.lock().unwrap().last().unwrap().0, 3);
    }

    #[test]
    fn extracts_only_the_selected_encrypted_entry_to_the_selected_folder() {
        // BE-P2-EXTRACT-PARTIAL-ENCRYPTED
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("encrypted.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        for (name, content) in [
            ("docs/readme.txt", b"selected".as_slice()),
            ("private/secret.txt", b"not selected".as_slice()),
        ] {
            let options = WriteOptions::builder()
                .encryption(libpna::Encryption::Aes)
                .password(Some("correct"))
                .build();
            let mut entry = EntryBuilder::new_file(EntryName::from(name), options).unwrap();
            entry.write_all(content).unwrap();
            entry.add_extra_chunk(RawChunk::from_data(
                plaintext_digest_chunk_type(),
                Sha256::digest(content).to_vec(),
            ));
            archive.add_entry(entry.build().unwrap()).unwrap();
        }
        archive.finalize().unwrap();
        let destination = temp.path().join("restore-here");

        let outcome = extract_archive(
            &ExtractRequest {
                archive_path: archive_path.clone(),
                destination: destination.clone(),
                entries: vec![PathBuf::from("docs/readme.txt")],
                password: Some("correct".into()),
                conflict: ConflictPolicy::Ask,
                restore_permissions: true,
                keep_completed_on_cancel: true,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        let root = destination.join("encrypted");
        assert_eq!(outcome.output_path, root);
        assert_eq!(outcome.completed_items, 1);
        assert_eq!(fs::read(root.join("docs/readme.txt")).unwrap(), b"selected");
        assert!(!root.join("private/secret.txt").exists());
        assert!(fs::read_dir(root.join("docs")).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("partial")));
    }

    #[test]
    fn encrypted_extract_with_no_matching_selection_is_not_a_password_error() {
        // BE-P2-EXTRACT-ENCRYPTED-EMPTY-SELECTION
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("encrypted.pna");
        write_archive(
            &archive_path,
            &[("present.txt", b"content")],
            Some("correct"),
        );
        let destination = temp.path().join("restore");

        let outcome = extract_archive(
            &ExtractRequest {
                archive_path,
                destination: destination.clone(),
                entries: vec![PathBuf::from("missing.txt")],
                password: Some("correct".into()),
                conflict: ConflictPolicy::Ask,
                restore_permissions: true,
                keep_completed_on_cancel: true,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(outcome.completed_items, 0);
        assert!(destination.join("encrypted").is_dir());
    }

    #[test]
    fn non_solid_wrong_password_never_commits_decrypted_garbage() {
        // BE-P2-EXTRACT-NORMAL-WRONG-PASSWORD
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("encrypted.pna");
        write_archive(
            &archive_path,
            &[("secret.txt", b"known plaintext")],
            Some("correct"),
        );
        let destination = temp.path().join("restore");

        let error = extract_archive(
            &ExtractRequest {
                archive_path,
                destination: destination.clone(),
                entries: vec![],
                password: Some("wrong".into()),
                conflict: ConflictPolicy::Ask,
                restore_permissions: true,
                keep_completed_on_cancel: true,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();

        assert_ne!(error.kind(), io::ErrorKind::NotFound);
        let root = destination.join("encrypted");
        assert!(!root.join("secret.txt").exists());
        if root.exists() {
            assert!(fs::read_dir(root).unwrap().all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("partial")));
        }
    }

    #[test]
    fn extract_archive_rejects_link_entries_before_writing() {
        // BE-P2-SEC-EXTRACT-SYMLINK-ENTRY, BE-P2-SEC-EXTRACT-HARDLINK-ENTRY
        for hard_link in [false, true] {
            let temp = tempdir().unwrap();
            let archive_path = temp.path().join("links.pna");
            let file = fs::File::create(&archive_path).unwrap();
            let mut archive = Archive::write_header(file).unwrap();
            let entry = if hard_link {
                EntryBuilder::new_hard_link(EntryName::from("link"), EntryReference::from("target"))
                    .unwrap()
            } else {
                EntryBuilder::new_symlink(
                    EntryName::from("link"),
                    EntryReference::from("../outside"),
                )
                .unwrap()
            };
            archive.add_entry(entry.build().unwrap()).unwrap();
            archive.finalize().unwrap();
            let destination = temp.path().join("restore");

            let error = extract_archive(
                &ExtractRequest {
                    archive_path,
                    destination: destination.clone(),
                    entries: vec![],
                    password: None,
                    conflict: ConflictPolicy::Ask,
                    restore_permissions: true,
                    keep_completed_on_cancel: true,
                },
                || false,
                |_, _, _| {},
            )
            .unwrap_err();

            assert_eq!(error.kind(), io::ErrorKind::InvalidData);
            assert!(!destination.join("links/link").exists());
        }
    }

    #[cfg(unix)]
    #[test]
    fn extract_archive_rejects_a_destination_directory_symlink() {
        // BE-P2-SEC-EXTRACT-DESTINATION-SYMLINK
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("sample.pna");
        write_archive(&archive_path, &[("linked/escape.txt", b"escape")], None);
        let destination = temp.path().join("restore");
        let root = destination.join("sample");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("linked")).unwrap();

        let error = extract_archive(
            &ExtractRequest {
                archive_path,
                destination,
                entries: vec![],
                password: None,
                conflict: ConflictPolicy::Overwrite,
                restore_permissions: true,
                keep_completed_on_cancel: true,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(!outside.join("escape.txt").exists());
    }

    #[test]
    fn create_validation_and_failures_leave_no_final_or_partial_output() {
        // BE-P2-CREATE-EMPTY, BE-P2-CREATE-IO-FAILURE, BE-P2-CREATE-OUTPUT-CONFLICT
        let temp = tempdir().unwrap();
        let output = temp.path().join("output.pna");
        let empty = CreateRequest {
            sources: vec![],
            output_path: output.clone(),
            overwrite: false,
            options: standard_options(),
        };
        assert_eq!(
            create_archive(&empty, || false, |_, _, _| {})
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidInput
        );
        assert!(!output.exists());

        let missing = CreateRequest {
            sources: vec![temp.path().join("missing")],
            ..empty.clone()
        };
        assert_eq!(
            create_archive(&missing, || false, |_, _, _| {})
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
        assert!(!output.exists());

        fs::write(&output, b"existing archive").unwrap();
        let source = temp.path().join("source.txt");
        fs::write(&source, b"new").unwrap();
        let conflict = CreateRequest {
            sources: vec![source],
            ..empty
        };
        assert_eq!(
            create_archive(&conflict, || false, |_, _, _| {})
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(&output).unwrap(), b"existing archive");
        assert!(fs::read_dir(temp.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("partial")));
    }

    #[test]
    fn create_cancellation_is_atomic_and_preserves_an_existing_output() {
        // BE-P2-CREATE-CANCEL-ATOMIC
        let temp = tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("a.txt"), b"a").unwrap();
        fs::write(source.join("b.txt"), b"b").unwrap();
        let output = temp.path().join("output.pna");
        fs::write(&output, b"original").unwrap();
        let progress = AtomicUsize::new(0);
        let error = create_archive(
            &CreateRequest {
                sources: vec![source],
                output_path: output.clone(),
                overwrite: true,
                options: standard_options(),
            },
            || progress.load(Ordering::Acquire) >= 1,
            |_, _, _| {
                progress.fetch_add(1, Ordering::Release);
            },
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert_eq!(fs::read(&output).unwrap(), b"original");
        assert!(fs::read_dir(temp.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("partial")));
    }

    #[test]
    fn create_overwrite_commits_the_replacement_and_removes_the_backup() {
        // BE-P2-CREATE-OVERWRITE
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.txt");
        let output = temp.path().join("output.pna");
        fs::write(&source, b"replacement content").unwrap();
        fs::write(&output, b"original archive").unwrap();

        let outcome = create_archive(
            &CreateRequest {
                sources: vec![source],
                output_path: output.clone(),
                overwrite: true,
                options: standard_options(),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert!(outcome.warnings.is_empty());
        let mut archive = Archive::read_header(fs::File::open(&output).unwrap()).unwrap();
        let entry = archive.entries().next().unwrap().unwrap();
        let libpna::ReadEntry::Normal(entry) = entry else {
            panic!("expected a normal replacement entry");
        };
        let mut content = Vec::new();
        entry
            .reader(ReadOptions::builder().build())
            .unwrap()
            .read_to_end(&mut content)
            .unwrap();
        assert_eq!(content, b"replacement content");
        assert!(fs::read_dir(temp.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("backup")));
    }

    #[test]
    fn overwrite_commit_reports_the_recovery_path_when_rollback_fails() {
        // BE-P2-CREATE-OVERWRITE-ROLLBACK-FAILURE
        let temp = tempdir().unwrap();
        let partial = temp.path().join(".output.pna.partial-test");
        let output = temp.path().join("output.pna");
        fs::write(&partial, b"replacement").unwrap();
        fs::write(&output, b"original").unwrap();
        let mut rename_call = 0;

        let error = commit_output_with(
            &partial,
            &output,
            true,
            |_from, _to| {
                rename_call += 1;
                match rename_call {
                    1 => Ok(()),
                    2 => Err(io::Error::other("simulated commit failure")),
                    3 => Err(io::Error::other("simulated rollback failure")),
                    _ => unreachable!(),
                }
            },
            |_path| Ok(()),
        )
        .unwrap_err();

        let message = error.to_string();
        assert!(message.contains("simulated commit failure"));
        assert!(message.contains("simulated rollback failure"));
        assert!(message.contains(".output.pna.backup-"));
    }

    #[test]
    fn overwrite_commit_treats_backup_cleanup_failure_as_a_warning() {
        // BE-P2-CREATE-OVERWRITE-CLEANUP-WARNING
        let temp = tempdir().unwrap();
        let partial = temp.path().join(".output.pna.partial-test");
        let output = temp.path().join("output.pna");
        fs::write(&partial, b"replacement").unwrap();
        fs::write(&output, b"original").unwrap();

        let warnings = commit_output_with(
            &partial,
            &output,
            true,
            |_from, _to| Ok(()),
            |_path| Err(io::Error::other("simulated cleanup failure")),
        )
        .unwrap();

        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("simulated cleanup failure"));
        assert!(warnings[0].contains(".output.pna.backup-"));
    }

    #[test]
    fn create_roundtrips_all_supported_compression_encryption_and_layout_options() {
        // BE-P2-CREATE-OPTION-CROSSPRODUCT
        for compression in [
            CreateCompression::Store,
            CreateCompression::Deflate,
            CreateCompression::Zstd,
            CreateCompression::Xz,
        ] {
            for encryption in [
                CreateEncryption::None,
                CreateEncryption::Aes,
                CreateEncryption::Camellia,
            ] {
                for solid in [false, true] {
                    let temp = tempdir().unwrap();
                    let source = temp.path().join("payload.txt");
                    fs::write(&source, b"option payload").unwrap();
                    let output = temp.path().join("output.pna");
                    let password = (!matches!(encryption, CreateEncryption::None))
                        .then(|| "secret".to_string());
                    create_archive(
                        &CreateRequest {
                            sources: vec![source],
                            output_path: output.clone(),
                            overwrite: false,
                            options: CreateOptions {
                                solid,
                                compression,
                                encryption,
                                password: password.clone(),
                                preserve_permissions: true,
                                reproducible: false,
                            },
                        },
                        || false,
                        |_, _, _| {},
                    )
                    .unwrap();
                    let mut archive =
                        Archive::read_header(fs::File::open(output).unwrap()).unwrap();
                    let mut entries =
                        archive.entries_with_password(password.as_deref().map(str::as_bytes));
                    let entry = entries.next().unwrap().unwrap();
                    let mut content = Vec::new();
                    entry
                        .reader(ReadOptions::with_password(password.as_deref()))
                        .unwrap()
                        .read_to_end(&mut content)
                        .unwrap();
                    assert_eq!(content, b"option payload");
                    assert!(entries.next().is_none());
                }
            }
        }
    }

    #[test]
    fn create_accepts_mixed_file_and_folder_sources_without_flattening_paths() {
        // BE-P2-CREATE-SINGLE, BE-P2-CREATE-MIXED
        let temp = tempdir().unwrap();
        let single = temp.path().join("single.txt");
        let folder = temp.path().join("folder");
        fs::write(&single, b"single").unwrap();
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("nested.txt"), b"nested").unwrap();
        let output = temp.path().join("mixed.pna");
        create_archive(
            &CreateRequest {
                sources: vec![single, folder],
                output_path: output.clone(),
                overwrite: false,
                options: standard_options(),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        let mut archive = Archive::read_header(fs::File::open(output).unwrap()).unwrap();
        let names = archive
            .entries_with_password(None)
            .map(|entry| entry.unwrap().header().path().as_path().to_path_buf())
            .collect::<Vec<_>>();
        assert!(names.contains(&PathBuf::from("single.txt")));
        assert!(names.contains(&PathBuf::from("folder/nested.txt")));
    }

    #[test]
    fn reproducible_creation_is_byte_identical_and_rejects_encryption() {
        // BE-P2-CREATE-REPRODUCIBLE, BE-P2-CREATE-REPRODUCIBLE-ENCRYPTED
        let temp = tempdir().unwrap();
        let source = temp.path().join("input.txt");
        fs::write(&source, b"deterministic payload").unwrap();
        let mut options = standard_options();
        options.reproducible = true;
        options.preserve_permissions = false;
        let first = temp.path().join("first.pna");
        let second = temp.path().join("second.pna");
        for output in [&first, &second] {
            create_archive(
                &CreateRequest {
                    sources: vec![source.clone()],
                    output_path: output.clone(),
                    overwrite: false,
                    options: options.clone(),
                },
                || false,
                |_, _, _| {},
            )
            .unwrap();
        }
        assert_eq!(fs::read(first).unwrap(), fs::read(second).unwrap());

        options.encryption = CreateEncryption::Aes;
        options.password = Some("secret".into());
        let error = create_archive(
            &CreateRequest {
                sources: vec![source],
                output_path: temp.path().join("invalid.pna"),
                overwrite: false,
                options,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn extract_all_conflict_policies_and_wrong_password_have_explicit_outcomes() {
        // BE-P2-EXTRACT-ALL, BE-P2-EXTRACT-CONFLICT-ASK, BE-P2-EXTRACT-CONFLICT-SKIP,
        // BE-P2-EXTRACT-CONFLICT-OVERWRITE, BE-P2-EXTRACT-CONFLICT-RENAME, BE-P2-EXTRACT-WRONG-PASSWORD
        let temp = tempdir().unwrap();
        let protected_source = temp.path().join("protected.txt");
        fs::write(&protected_source, b"protected").unwrap();
        let protected_archive = temp.path().join("protected.pna");
        create_archive(
            &CreateRequest {
                sources: vec![protected_source],
                output_path: protected_archive.clone(),
                overwrite: false,
                options: CreateOptions {
                    solid: true,
                    compression: CreateCompression::Zstd,
                    encryption: CreateEncryption::Aes,
                    password: Some("correct".into()),
                    preserve_permissions: true,
                    reproducible: false,
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        let wrong = ExtractRequest {
            archive_path: protected_archive,
            destination: temp.path().join("wrong"),
            entries: vec![],
            password: Some("wrong".into()),
            conflict: ConflictPolicy::Ask,
            restore_permissions: true,
            keep_completed_on_cancel: true,
        };
        assert!(extract_archive(&wrong, || false, |_, _, _| {}).is_err());

        let archive_path = temp.path().join("plain.pna");
        write_archive(&archive_path, &[("file.txt", b"new")], None);
        let destination = temp.path().join("restore");
        let request = |policy| ExtractRequest {
            archive_path: archive_path.clone(),
            destination: destination.clone(),
            entries: vec![],
            password: None,
            conflict: policy,
            restore_permissions: true,
            keep_completed_on_cancel: true,
        };
        let first = extract_archive(&request(ConflictPolicy::Ask), || false, |_, _, _| {}).unwrap();
        assert_eq!(first.completed_items, 1);
        let output = destination.join("plain/file.txt");
        assert_eq!(fs::read(&output).unwrap(), b"new");
        fs::write(&output, b"existing").unwrap();
        assert_eq!(
            extract_archive(&request(ConflictPolicy::Ask), || false, |_, _, _| {})
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        extract_archive(&request(ConflictPolicy::Skip), || false, |_, _, _| {}).unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"existing");
        extract_archive(&request(ConflictPolicy::Overwrite), || false, |_, _, _| {}).unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"new");
        fs::write(&output, b"existing").unwrap();
        extract_archive(&request(ConflictPolicy::Rename), || false, |_, _, _| {}).unwrap();
        assert_eq!(
            fs::read(destination.join("plain/file (1).txt")).unwrap(),
            b"new"
        );
    }

    #[test]
    fn extraction_cancellation_removes_partial_and_completed_outputs_by_policy() {
        // BE-P2-EXTRACT-CANCEL-ATOMIC
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("cancel.pna");
        write_archive(
            &archive_path,
            &[("first.txt", b"first"), ("large.bin", &vec![7; 256 * 1024])],
            None,
        );
        let destination = temp.path().join("restore");
        let checks = AtomicUsize::new(0);
        let error = extract_archive(
            &ExtractRequest {
                archive_path,
                destination: destination.clone(),
                entries: vec![],
                password: None,
                conflict: ConflictPolicy::Ask,
                restore_permissions: true,
                keep_completed_on_cancel: false,
            },
            || checks.fetch_add(1, Ordering::AcqRel) > 5,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        let root = destination.join("cancel");
        assert!(!root.join("first.txt").exists());
        if root.exists() {
            assert!(fs::read_dir(root).unwrap().all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("partial")));
        }
    }

    #[test]
    fn extraction_cancellation_keeps_completed_outputs_when_requested() {
        // BE-P2-EXTRACT-CANCEL-KEEP-COMPLETED
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("cancel.pna");
        write_archive(
            &archive_path,
            &[("first.txt", b"first"), ("second.txt", b"second")],
            None,
        );
        let destination = temp.path().join("restore");
        let cancelled = AtomicBool::new(false);

        let error = extract_archive(
            &ExtractRequest {
                archive_path,
                destination: destination.clone(),
                entries: vec![],
                password: None,
                conflict: ConflictPolicy::Ask,
                restore_permissions: true,
                keep_completed_on_cancel: true,
            },
            || cancelled.load(Ordering::Acquire),
            |completed, _, _| {
                if completed == 1 {
                    cancelled.store(true, Ordering::Release);
                }
            },
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        let root = destination.join("cancel");
        assert_eq!(fs::read(root.join("first.txt")).unwrap(), b"first");
        assert!(!root.join("second.txt").exists());
    }

    #[test]
    fn extraction_rejects_known_insufficient_space_before_writing() {
        // BE-P2-EXTRACT-NO-SPACE
        let error = ensure_space(4096, 1024).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::StorageFull);
        ensure_space(1024, 4096).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn extraction_restores_stored_permissions_when_requested() {
        // BE-P2-EXTRACT-PERMISSIONS
        use std::os::unix::fs::PermissionsExt;
        let temp = tempdir().unwrap();
        let source = temp.path().join("script.sh");
        fs::write(&source, b"#!/bin/sh\n").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o751)).unwrap();
        let archive_path = temp.path().join("permissions.pna");
        create_archive(
            &CreateRequest {
                sources: vec![source],
                output_path: archive_path.clone(),
                overwrite: false,
                options: standard_options(),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        let destination = temp.path().join("restore");
        extract_archive(
            &ExtractRequest {
                archive_path,
                destination: destination.clone(),
                entries: vec![],
                password: None,
                conflict: ConflictPolicy::Ask,
                restore_permissions: true,
                keep_completed_on_cancel: true,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            fs::metadata(destination.join("permissions/script.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o751
        );
    }
}
