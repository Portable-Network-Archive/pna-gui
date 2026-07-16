use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use libpna::{
    Archive, Chunk, ChunkType, EntryBuilder, EntryName, EntryPart, NormalEntry, PermissionMode,
    RawChunk, ReadEntry, SolidEntryBuilder, WriteOptions, MIN_CHUNK_BYTES_SIZE, PNA_HEADER,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);
pub(crate) const PLAINTEXT_DIGEST_CHUNK_BYTES: [u8; 4] = *b"phSh";

fn plaintext_digest_chunk_type() -> ChunkType {
    ChunkType::private(PLAINTEXT_DIGEST_CHUNK_BYTES)
        .expect("the PNA GUI digest chunk type is valid")
}

pub(crate) fn split_part_name(stem: &str, part: usize) -> String {
    format!("{stem}.part{part}.pna")
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendRequest {
    pub archive_path: PathBuf,
    pub sources: Vec<PathBuf>,
    pub options: CreateOptions,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEntriesRequest {
    pub archive_path: PathBuf,
    pub entries: Vec<PathBuf>,
    pub password: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameEntryRequest {
    pub archive_path: PathBuf,
    pub source_path: PathBuf,
    pub destination_path: PathBuf,
    pub password: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitRequest {
    pub archive_path: PathBuf,
    pub output_directory: PathBuf,
    pub max_part_bytes: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcatRequest {
    pub parts: Vec<PathBuf>,
    pub output_path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SortRequest {
    pub archive_path: PathBuf,
    pub output_path: PathBuf,
    pub password: Option<String>,
    pub descending: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StripMetadataRequest {
    pub archive_path: PathBuf,
    pub output_path: PathBuf,
    pub password: Option<String>,
    pub keep_timestamps: bool,
    pub keep_permissions: bool,
    pub keep_xattrs: bool,
    pub keep_private_chunks: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateRequest {
    pub archive_path: PathBuf,
    pub output_path: PathBuf,
    pub password: Option<String>,
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

pub fn append_archive<C, P>(
    request: &AppendRequest,
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
    if !request.archive_path.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "the archive to update does not exist",
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
            "a password is required for encrypted additions",
        ));
    }

    let initial = FileFingerprint::read(&request.archive_path)?;
    let additions = scan_sources(&request.sources)?;
    let mut existing_names = HashSet::new();
    let file = fs::File::open(&request.archive_path)?;
    let mut archive = Archive::read_header(file)?;
    for entry in
        archive.entries_with_password(request.options.password.as_deref().map(str::as_bytes))
    {
        check_cancelled(&cancelled)?;
        existing_names.insert(entry?.name().as_path().to_path_buf());
    }
    for addition in &additions {
        if existing_names.contains(&addition.archive_path) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!(
                    "the archive already contains {}",
                    addition.archive_path.display()
                ),
            ));
        }
    }

    let partial = unique_sibling_path(&request.archive_path, "partial")?;
    let mut partial_guard = PartialFile::new(partial.clone());
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let mut writer = Archive::write_header(output)?;
    let file = fs::File::open(&request.archive_path)?;
    let mut source = Archive::read_header(file)?;
    for entry in source.raw_entries() {
        check_cancelled(&cancelled)?;
        writer.add_entry(entry?)?;
    }

    let total = additions.len() as u64;
    if request.options.solid {
        let mut solid = SolidEntryBuilder::new(write_options(&request.options))?;
        for (offset, addition) in additions.iter().enumerate() {
            check_cancelled(&cancelled)?;
            solid.add_entry(build_scanned_entry(addition, &request.options)?)?;
            progress(
                offset as u64 + 1,
                total,
                &addition.archive_path.to_string_lossy(),
            );
        }
        writer.add_entry(solid.build()?)?;
    } else {
        for (offset, addition) in additions.iter().enumerate() {
            check_cancelled(&cancelled)?;
            writer.add_entry(build_scanned_entry(addition, &request.options)?)?;
            progress(
                offset as u64 + 1,
                total,
                &addition.archive_path.to_string_lossy(),
            );
        }
    }
    let output = writer.finalize()?;
    output.sync_all()?;
    check_cancelled(&cancelled)?;
    if FileFingerprint::read(&request.archive_path)? != initial {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "the archive changed while it was being updated; no changes were committed",
        ));
    }
    let warnings = commit_output(&partial, &request.archive_path, true)?;
    partial_guard.commit();
    Ok(OperationOutcome {
        output_path: request.archive_path.clone(),
        completed_items: total,
        warnings,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileFingerprint {
    len: u64,
    modified: Option<std::time::SystemTime>,
    digest: [u8; 32],
}

impl FileFingerprint {
    fn read(path: &Path) -> io::Result<Self> {
        let mut file = fs::File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        let metadata = file.metadata()?;
        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            digest: hasher.finalize().into(),
        })
    }
}

pub fn delete_archive_entries<C, P>(
    request: &DeleteEntriesRequest,
    cancelled: C,
    progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    if request.entries.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "at least one archive entry must be selected",
        ));
    }
    let selections = request
        .entries
        .iter()
        .map(|path| super::safe_relative_entry_path(path))
        .collect::<io::Result<Vec<_>>>()?;
    let (outcome, changed) = transform_archive(
        &request.archive_path,
        request.password.as_deref(),
        cancelled,
        progress,
        |entry| {
            let name = entry.name().as_path();
            Ok((!selections
                .iter()
                .any(|selected| name == selected || name.starts_with(selected)))
            .then_some(entry))
        },
    )?;
    if changed == 0 {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "none of the selected archive entries were found",
        ));
    }
    Ok(outcome)
}

pub fn rename_archive_entry<C, P>(
    request: &RenameEntryRequest,
    cancelled: C,
    progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    let source = super::safe_relative_entry_path(&request.source_path)?;
    let destination = super::safe_relative_entry_path(&request.destination_path)?;
    if source == destination {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the new archive path is unchanged",
        ));
    }
    let (outcome, changed) = transform_archive(
        &request.archive_path,
        request.password.as_deref(),
        cancelled,
        progress,
        |entry| {
            let name = entry.name().as_path();
            if name == source || name.starts_with(&source) {
                let suffix = name.strip_prefix(&source).unwrap_or_else(|_| Path::new(""));
                let renamed = if suffix.as_os_str().is_empty() {
                    destination.clone()
                } else {
                    destination.join(suffix)
                };
                Ok(Some(entry.with_name(EntryName::from_lossy(renamed))))
            } else {
                Ok(Some(entry))
            }
        },
    )?;
    if changed == 0 {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("archive entry not found: {}", source.display()),
        ));
    }
    Ok(outcome)
}

fn transform_archive<C, P, F>(
    archive_path: &Path,
    password: Option<&str>,
    cancelled: C,
    mut progress: P,
    mut transform: F,
) -> io::Result<(OperationOutcome, u64)>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
    F: FnMut(NormalEntry) -> io::Result<Option<NormalEntry>>,
{
    let initial = FileFingerprint::read(archive_path)?;
    let file = fs::File::open(archive_path)?;
    let mut source = Archive::read_header(file)?;
    let entries = source.entries().collect::<io::Result<Vec<_>>>()?;
    let total = entries.iter().try_fold(0_u64, |total, read_entry| {
        check_cancelled(&cancelled)?;
        match read_entry {
            ReadEntry::Normal(_) => Ok(total + 1),
            ReadEntry::Solid(solid) => solid
                .entries(password.map(str::as_bytes))?
                .try_fold(total, |count, entry| entry.map(|_| count + 1)),
        }
    })?;
    let partial = unique_sibling_path(archive_path, "partial")?;
    let mut partial_guard = PartialFile::new(partial.clone());
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let mut writer = Archive::write_header(output)?;
    let mut seen = HashSet::new();
    let mut completed = 0_u64;
    let mut changed = 0_u64;

    for read_entry in entries {
        check_cancelled(&cancelled)?;
        match read_entry {
            ReadEntry::Normal(entry) => {
                let original_name = entry.name().to_string();
                match transform(entry)? {
                    Some(entry) => {
                        let name = entry.name().as_path().to_path_buf();
                        if !seen.insert(name.clone()) {
                            return Err(io::Error::new(
                                io::ErrorKind::AlreadyExists,
                                format!(
                                    "the edited archive would contain duplicate path {}",
                                    name.display()
                                ),
                            ));
                        }
                        changed += u64::from(entry.name().to_string() != original_name);
                        writer.add_entry(entry)?;
                    }
                    None => changed += 1,
                }
                completed += 1;
                progress(completed, total, &original_name);
            }
            ReadEntry::Solid(solid) => {
                let mut options = WriteOptions::builder();
                options
                    .compression(solid.compression())
                    .encryption(solid.encryption())
                    .cipher_mode(solid.cipher_mode())
                    .password(password);
                let mut builder = SolidEntryBuilder::new(options.build())?;
                for chunk in solid.extra_chunks() {
                    builder.add_extra_chunk(chunk.clone());
                }
                let mut retained = 0_u64;
                for item in solid.entries(password.map(str::as_bytes))? {
                    check_cancelled(&cancelled)?;
                    let entry = item?;
                    let original_name = entry.name().to_string();
                    match transform(entry)? {
                        Some(entry) => {
                            let name = entry.name().as_path().to_path_buf();
                            if !seen.insert(name.clone()) {
                                return Err(io::Error::new(
                                    io::ErrorKind::AlreadyExists,
                                    format!(
                                        "the edited archive would contain duplicate path {}",
                                        name.display()
                                    ),
                                ));
                            }
                            changed += u64::from(entry.name().to_string() != original_name);
                            builder.add_entry(entry)?;
                            retained += 1;
                        }
                        None => changed += 1,
                    }
                    completed += 1;
                    progress(completed, total, &original_name);
                }
                if retained > 0 {
                    writer.add_entry(builder.build()?)?;
                }
            }
        }
    }
    if changed == 0 {
        return Ok((
            OperationOutcome {
                output_path: archive_path.to_path_buf(),
                completed_items: completed,
                warnings: Vec::new(),
            },
            0,
        ));
    }
    let output = writer.finalize()?;
    output.sync_all()?;
    check_cancelled(&cancelled)?;
    if FileFingerprint::read(archive_path)? != initial {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "the archive changed while it was being edited; no changes were committed",
        ));
    }
    let warnings = commit_output(&partial, archive_path, true)?;
    partial_guard.commit();
    Ok((
        OperationOutcome {
            output_path: archive_path.to_path_buf(),
            completed_items: completed,
            warnings,
        },
        changed,
    ))
}

const SPLIT_OVERHEAD_BYTES: usize = PNA_HEADER.len() + MIN_CHUNK_BYTES_SIZE * 3 + 8;
const MIN_SPLIT_BYTES: usize = SPLIT_OVERHEAD_BYTES + MIN_CHUNK_BYTES_SIZE;

pub fn split_archive<C, P>(
    request: &SplitRequest,
    cancelled: C,
    mut progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    if request.max_part_bytes < MIN_SPLIT_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("part size must be at least {MIN_SPLIT_BYTES} bytes"),
        ));
    }
    fs::create_dir_all(&request.output_directory)?;
    let stem = request
        .archive_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "archive has no portable name")
        })?;
    let public_path = |part: usize| request.output_directory.join(split_part_name(stem, part));
    if public_path(1).exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("split output already exists: {}", public_path(1).display()),
        ));
    }

    let source_file = fs::File::open(&request.archive_path)?;
    let mut source = Archive::read_header(source_file)?;
    let total_entries = source.raw_entries().try_fold(0_u64, |count, entry| {
        entry?;
        Ok::<_, io::Error>(count + 1)
    })?;
    let source_file = fs::File::open(&request.archive_path)?;
    let mut source = Archive::read_header(source_file)?;
    let mut temp_files = TempFiles::default();
    let first_temp = unique_sibling_path(&public_path(1), "partial")?;
    temp_files.paths.push(first_temp.clone());
    let first_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&first_temp)?;
    let mut writer = Archive::write_header(first_file)?;
    let capacity = request.max_part_bytes - SPLIT_OVERHEAD_BYTES;
    let mut written = 0_usize;
    let mut part_number = 1_usize;

    for (entry_index, entry) in source.raw_entries().enumerate() {
        check_cancelled(&cancelled)?;
        let part = EntryPart::from(entry?);
        let pieces = split_entry_part(part.as_ref(), capacity - written, capacity)?;
        for piece in pieces {
            if written + piece.bytes_len() > capacity {
                part_number += 1;
                if public_path(part_number).exists() {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        format!(
                            "split output already exists: {}",
                            public_path(part_number).display()
                        ),
                    ));
                }
                let temp = unique_sibling_path(&public_path(part_number), "partial")?;
                temp_files.paths.push(temp.clone());
                let file = OpenOptions::new().write(true).create_new(true).open(temp)?;
                writer = writer.split_to_next_archive(file)?;
                written = 0;
            }
            written += writer.add_entry_part(piece)?;
        }
        progress(
            entry_index as u64 + 1,
            total_entries,
            &public_path(part_number).to_string_lossy(),
        );
    }
    writer.finalize()?.sync_all()?;
    check_cancelled(&cancelled)?;
    // Publish part 1 last. Its presence is the completeness marker used by
    // discovery, so a publication failure can never leave a truncated prefix
    // that concat mistakes for a complete set.
    for part in (1..=part_number).rev() {
        let public = public_path(part);
        publish_new_output(&temp_files.paths[part - 1], &public)?;
        temp_files.published.push(public);
    }
    temp_files.commit();
    Ok(OperationOutcome {
        output_path: public_path(1),
        completed_items: part_number as u64,
        warnings: Vec::new(),
    })
}

fn split_entry_part<'a>(
    mut part: EntryPart<&'a [u8]>,
    first: usize,
    max: usize,
) -> io::Result<Vec<EntryPart<&'a [u8]>>> {
    let mut pieces = Vec::new();
    let mut limit = first;
    loop {
        match part.try_split(limit) {
            Ok((piece, Some(remaining))) => {
                pieces.push(piece);
                part = remaining;
                limit = max;
            }
            Ok((piece, None)) => {
                pieces.push(piece);
                return Ok(pieces);
            }
            Err(unsplit) if limit < max && pieces.is_empty() => {
                part = unsplit;
                limit = max;
            }
            Err(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("an archive chunk cannot fit within a {max}-byte part"),
                ));
            }
        }
    }
}

pub fn concat_archives<C, P>(
    request: &ConcatRequest,
    cancelled: C,
    mut progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    let parts = discover_concat_parts(&request.parts)?;
    if request.output_path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "the concat output already exists",
        ));
    }
    let parent = request
        .output_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let partial = unique_sibling_path(&request.output_path, "partial")?;
    let mut guard = PartialFile::new(partial.clone());
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let mut writer = Archive::write_header(output)?;
    let mut files = parts
        .iter()
        .map(fs::File::open)
        .collect::<io::Result<Vec<_>>>()?
        .into_iter();
    let first = files.next().expect("parts is non-empty");
    let mut source = Archive::read_header(first)?;
    let mut completed = 0_u64;
    loop {
        check_cancelled(&cancelled)?;
        for entry in source.raw_entries() {
            writer.add_entry(entry?)?;
        }
        completed += 1;
        progress(
            completed,
            parts.len() as u64,
            &parts[completed as usize - 1].to_string_lossy(),
        );
        if source.has_next_archive() {
            let next = files.next().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("split archive part {} is missing", completed + 1),
                )
            })?;
            source = source.read_next_archive(next)?;
        } else {
            if files.next().is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "the selected set contains an unexpected extra part",
                ));
            }
            break;
        }
    }
    writer.finalize()?.sync_all()?;
    check_cancelled(&cancelled)?;
    publish_new_output(&partial, &request.output_path)?;
    guard.commit();
    Ok(OperationOutcome {
        output_path: request.output_path.clone(),
        completed_items: completed,
        warnings: Vec::new(),
    })
}

fn discover_concat_parts(selected: &[PathBuf]) -> io::Result<Vec<PathBuf>> {
    if selected.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "at least one split archive part is required",
        ));
    }
    let unique = selected.iter().collect::<HashSet<_>>();
    if unique.len() != selected.len() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the selected split archive parts contain a duplicate path",
        ));
    }

    let (directory, stem, _) = parse_split_part_path(&selected[0])?;
    for selected_path in selected {
        if !selected_path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!(
                    "split archive part was not found: {}",
                    selected_path.display()
                ),
            ));
        }
        let (candidate_directory, candidate_stem, _) = parse_split_part_path(selected_path)?;
        if candidate_directory != directory || candidate_stem != stem {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "all selected split archive parts must belong to the same named set",
            ));
        }
    }

    let mut discovered = Vec::new();
    for entry in fs::read_dir(&directory)? {
        let path = entry?.path();
        if let Ok((candidate_directory, candidate_stem, number)) = parse_split_part_path(&path) {
            if candidate_directory == directory && candidate_stem == stem {
                discovered.push((number, path));
            }
        }
    }
    discovered.sort_by_key(|(number, _)| *number);
    for (offset, (number, _)) in discovered.iter().enumerate() {
        let expected = offset + 1;
        if *number != expected {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!(
                    "split archive part is missing: {}",
                    directory.join(split_part_name(&stem, expected)).display()
                ),
            ));
        }
    }
    if discovered.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "no split archive parts were found",
        ));
    }
    Ok(discovered.into_iter().map(|(_, path)| path).collect())
}

fn parse_split_part_path(path: &Path) -> io::Result<(PathBuf, String, usize)> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "split archive part has no portable name",
            )
        })?;
    let without_extension = file_name.strip_suffix(".pna").ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("split archive part must end in .pna: {}", path.display()),
        )
    })?;
    let (stem, number) = without_extension.rsplit_once(".part").ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "split archive part must use the name <archive>.partN.pna: {}",
                path.display()
            ),
        )
    })?;
    if stem.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "split archive part has an empty archive name",
        ));
    }
    let number = number.parse::<usize>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "split archive part has an invalid sequence number: {}",
                path.display()
            ),
        )
    })?;
    if number == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "split archive part numbers start at 1",
        ));
    }
    Ok((
        path.parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf(),
        stem.to_owned(),
        number,
    ))
}

#[derive(Default)]
struct TempFiles {
    paths: Vec<PathBuf>,
    published: Vec<PathBuf>,
    committed: bool,
}

impl TempFiles {
    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for TempFiles {
    fn drop(&mut self) {
        if !self.committed {
            for path in &self.paths {
                let _ = fs::remove_file(path);
            }
            for path in &self.published {
                let _ = fs::remove_file(path);
            }
        }
    }
}

pub fn sort_archive<C, P>(
    request: &SortRequest,
    cancelled: C,
    mut progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    validate_separate_output(&request.archive_path, &request.output_path)?;
    let file = fs::File::open(&request.archive_path)?;
    let mut source = Archive::read_header(file)?;
    let read_entries = source.entries().collect::<io::Result<Vec<_>>>()?;
    let has_normal = read_entries
        .iter()
        .any(|entry| matches!(entry, ReadEntry::Normal(_)));
    let has_solid = read_entries
        .iter()
        .any(|entry| matches!(entry, ReadEntry::Solid(_)));
    if has_normal && has_solid {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "mixed normal and solid archives cannot be globally sorted without changing their storage model",
        ));
    }
    let solid_group_count = read_entries
        .iter()
        .filter(|entry| matches!(entry, ReadEntry::Solid(_)))
        .count();
    let solid_group_has_metadata = read_entries
        .iter()
        .any(|entry| matches!(entry, ReadEntry::Solid(solid) if !solid.extra_chunks().is_empty()));
    if solid_group_count > 1 && solid_group_has_metadata {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "multiple solid groups with group metadata cannot be merged without changing metadata scope",
        ));
    }

    let partial = prepare_separate_partial(&request.output_path)?;
    let mut guard = PartialFile::new(partial.clone());
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let mut writer = Archive::write_header(output)?;
    let mut logical = Vec::new();
    let mut solid_settings = None;
    let mut solid_extras = Vec::new();
    for read_entry in read_entries {
        check_cancelled(&cancelled)?;
        match read_entry {
            ReadEntry::Normal(entry) => logical.push(entry),
            ReadEntry::Solid(solid) => {
                let settings = (solid.compression(), solid.encryption(), solid.cipher_mode());
                if solid_settings.is_some_and(|current| current != settings) {
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        "solid groups with different compression or encryption settings cannot be merged safely",
                    ));
                }
                if solid_settings.is_none() {
                    solid_settings = Some(settings);
                    solid_extras = solid.extra_chunks().to_vec();
                }
                logical.extend(
                    solid
                        .entries(request.password.as_deref().map(str::as_bytes))?
                        .collect::<io::Result<Vec<_>>>()?,
                );
            }
        }
    }
    logical.sort_by(|left, right| left.name().cmp(right.name()));
    if request.descending {
        logical.reverse();
    }
    let total = logical.len() as u64;
    if let Some((compression, encryption, cipher_mode)) = solid_settings {
        let mut options = WriteOptions::builder();
        options
            .compression(compression)
            .encryption(encryption)
            .cipher_mode(cipher_mode)
            .password(request.password.as_deref());
        let mut solid = SolidEntryBuilder::new(options.build())?;
        for chunk in solid_extras {
            solid.add_extra_chunk(chunk);
        }
        for (index, entry) in logical.into_iter().enumerate() {
            check_cancelled(&cancelled)?;
            let name = entry.name().to_string();
            solid.add_entry(entry)?;
            progress(index as u64 + 1, total, &name);
        }
        writer.add_entry(solid.build()?)?;
    } else {
        for (index, entry) in logical.into_iter().enumerate() {
            check_cancelled(&cancelled)?;
            let name = entry.name().to_string();
            writer.add_entry(entry)?;
            progress(index as u64 + 1, total, &name);
        }
    }
    writer.finalize()?.sync_all()?;
    publish_new_output(&partial, &request.output_path)?;
    guard.commit();
    Ok(OperationOutcome {
        output_path: request.output_path.clone(),
        completed_items: total,
        warnings: Vec::new(),
    })
}

pub fn strip_archive_metadata<C, P>(
    request: &StripMetadataRequest,
    cancelled: C,
    progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    rewrite_archive_to(
        &request.archive_path,
        &request.output_path,
        request.password.as_deref(),
        cancelled,
        progress,
        |entry| {
            let source = entry.metadata();
            let mut metadata =
                libpna::Metadata::new().with_link_target_type(source.link_target_type());
            if request.keep_timestamps {
                metadata = metadata
                    .with_created(source.created())
                    .with_modified(source.modified())
                    .with_accessed(source.accessed());
            }
            if request.keep_permissions {
                metadata = metadata
                    .with_owner_uid(source.owner_uid())
                    .with_owner_gid(source.owner_gid())
                    .with_owner_user_name(source.owner_user_name().cloned())
                    .with_owner_group_name(source.owner_group_name().cloned())
                    .with_owner_user_sid(source.owner_user_sid().cloned())
                    .with_owner_group_sid(source.owner_group_sid().cloned())
                    .with_permission_mode(source.permission_mode());
            }
            let mut updated = entry.with_metadata(metadata);
            if !request.keep_xattrs {
                updated = updated.with_xattrs(&[]);
            }
            if !request.keep_private_chunks {
                let integrity = updated
                    .extra_chunks()
                    .iter()
                    .filter(|chunk| chunk.ty() == plaintext_digest_chunk_type())
                    .cloned()
                    .collect::<Vec<_>>();
                updated = updated.with_extra_chunks(integrity);
            }
            Ok(updated)
        },
    )
}

pub fn migrate_archive<C, P>(
    request: &MigrateRequest,
    cancelled: C,
    progress: P,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    rewrite_archive_to(
        &request.archive_path,
        &request.output_path,
        request.password.as_deref(),
        cancelled,
        progress,
        |entry| {
            let metadata = entry.metadata().clone();
            Ok(entry.with_metadata(metadata))
        },
    )
}

fn rewrite_archive_to<C, P, F>(
    archive_path: &Path,
    output_path: &Path,
    password: Option<&str>,
    cancelled: C,
    mut progress: P,
    mut transform: F,
) -> io::Result<OperationOutcome>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
    F: FnMut(NormalEntry) -> io::Result<NormalEntry>,
{
    validate_separate_output(archive_path, output_path)?;
    let file = fs::File::open(archive_path)?;
    let mut source = Archive::read_header(file)?;
    let entries = source.entries().collect::<io::Result<Vec<_>>>()?;
    let total = entries.iter().try_fold(0_u64, |total, read_entry| {
        check_cancelled(&cancelled)?;
        match read_entry {
            ReadEntry::Normal(_) => Ok(total + 1),
            ReadEntry::Solid(solid) => solid
                .entries(password.map(str::as_bytes))?
                .try_fold(total, |count, entry| entry.map(|_| count + 1)),
        }
    })?;
    let partial = prepare_separate_partial(output_path)?;
    let mut guard = PartialFile::new(partial.clone());
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let mut writer = Archive::write_header(output)?;
    let mut completed = 0_u64;
    for read_entry in entries {
        check_cancelled(&cancelled)?;
        match read_entry {
            ReadEntry::Normal(entry) => {
                let entry = transform(entry)?;
                completed += 1;
                progress(completed, total, &entry.name().to_string());
                writer.add_entry(entry)?;
            }
            ReadEntry::Solid(solid) => {
                let mut options = WriteOptions::builder();
                options
                    .compression(solid.compression())
                    .encryption(solid.encryption())
                    .cipher_mode(solid.cipher_mode())
                    .password(password);
                let mut builder = SolidEntryBuilder::new(options.build())?;
                for chunk in solid.extra_chunks() {
                    builder.add_extra_chunk(chunk.clone());
                }
                for entry in solid.entries(password.map(str::as_bytes))? {
                    check_cancelled(&cancelled)?;
                    let entry = transform(entry?)?;
                    completed += 1;
                    progress(completed, total, &entry.name().to_string());
                    builder.add_entry(entry)?;
                }
                writer.add_entry(builder.build()?)?;
            }
        }
    }
    writer.finalize()?.sync_all()?;
    publish_new_output(&partial, output_path)?;
    guard.commit();
    Ok(OperationOutcome {
        output_path: output_path.to_path_buf(),
        completed_items: completed,
        warnings: Vec::new(),
    })
}

fn validate_separate_output(source: &Path, output: &Path) -> io::Result<()> {
    if source == output {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "this operation requires a separate output path",
        ));
    }
    if output.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "the output archive already exists",
        ));
    }
    Ok(())
}

fn prepare_separate_partial(output: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(output.parent().unwrap_or_else(|| Path::new(".")))?;
    unique_sibling_path(output, "partial")
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

/// Publishes a completed sibling temporary file without ever replacing an
/// output that appeared after preflight. A hard link is an atomic no-clobber
/// operation on the same filesystem; the temporary name is removed only after
/// the public name exists.
fn publish_new_output(partial: &Path, output: &Path) -> io::Result<()> {
    match fs::hard_link(partial, output) {
        Ok(()) => match fs::remove_file(partial) {
            Ok(()) => Ok(()),
            Err(remove_error) => match fs::remove_file(output) {
                Ok(()) => Err(remove_error),
                Err(rollback_error) => Err(io::Error::new(
                    remove_error.kind(),
                    format!(
                        "output was published at {}, but the temporary file could not be removed: {remove_error}; removing the published output also failed: {rollback_error}",
                        output.display()
                    ),
                )),
            },
        },
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("the output archive already exists: {}", output.display()),
        )),
        Err(error) => Err(error),
    }
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

    use libpna::{
        Archive, Duration, EntryReference, ExtendedAttribute, ReadOptions, XattrName, XattrValue,
    };
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
    fn append_replaces_the_archive_atomically_and_preserves_existing_entries() {
        // BE-UPDATE-APPEND-ATOMIC-SUCCESS
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("project.pna");
        let source = temp.path().join("new.txt");
        write_archive(&archive_path, &[("old.txt", b"old payload")], None);
        fs::write(&source, b"new payload").unwrap();

        let outcome = append_archive(
            &AppendRequest {
                archive_path: archive_path.clone(),
                sources: vec![source],
                options: standard_options(),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(outcome.output_path, archive_path);
        let file = fs::File::open(&archive_path).unwrap();
        let mut archive = Archive::read_header(file).unwrap();
        let mut contents = archive
            .entries_with_password(None)
            .map(|entry| {
                let entry = entry.unwrap();
                let name = entry.name().to_string();
                let mut bytes = Vec::new();
                entry
                    .reader(ReadOptions::builder().build())
                    .unwrap()
                    .read_to_end(&mut bytes)
                    .unwrap();
                (name, bytes)
            })
            .collect::<Vec<_>>();
        contents.sort_by(|left, right| left.0.cmp(&right.0));
        assert_eq!(
            contents,
            vec![
                ("new.txt".to_string(), b"new payload".to_vec()),
                ("old.txt".to_string(), b"old payload".to_vec()),
            ]
        );
    }

    #[test]
    fn rename_moves_a_directory_tree_without_touching_unrelated_entries() {
        // BE-UPDATE-RENAME-TREE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("project.pna");
        write_archive(
            &archive_path,
            &[
                ("docs/readme.txt", b"readme"),
                ("docs/guide.txt", b"guide"),
                ("keep.txt", b"keep"),
            ],
            None,
        );

        rename_archive_entry(
            &RenameEntryRequest {
                archive_path: archive_path.clone(),
                source_path: "docs".into(),
                destination_path: "manual".into(),
                password: None,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(
            archive_names(&archive_path, None),
            vec!["keep.txt", "manual/guide.txt", "manual/readme.txt"]
        );
    }

    #[test]
    fn delete_removes_only_the_explicit_selection_tree() {
        // BE-UPDATE-DELETE-SELECTION
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("project.pna");
        write_archive(
            &archive_path,
            &[
                ("remove/a.txt", b"a"),
                ("remove/b.txt", b"b"),
                ("keep.txt", b"keep"),
            ],
            None,
        );

        delete_archive_entries(
            &DeleteEntriesRequest {
                archive_path: archive_path.clone(),
                entries: vec!["remove".into()],
                password: None,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(archive_names(&archive_path, None), vec!["keep.txt"]);
    }

    #[test]
    fn edit_does_not_replace_an_archive_changed_by_another_writer() {
        // BE-UPDATE-EDIT-CONCURRENT-CHANGE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("project.pna");
        write_archive(
            &archive_path,
            &[("remove.txt", b"remove"), ("keep.txt", b"keep")],
            None,
        );
        let external_contents = b"external writer owns this path";
        let mut changed = false;

        let error = delete_archive_entries(
            &DeleteEntriesRequest {
                archive_path: archive_path.clone(),
                entries: vec!["remove.txt".into()],
                password: None,
            },
            || false,
            |_, _, _| {
                if !changed {
                    fs::write(&archive_path, external_contents).unwrap();
                    changed = true;
                }
            },
        )
        .unwrap_err();

        assert!(error.to_string().contains("changed"));
        assert_eq!(fs::read(&archive_path).unwrap(), external_contents);
    }

    #[test]
    fn split_and_concat_round_trip_without_changing_the_source() {
        // BE-VOLUME-SPLIT-CONCAT-ROUNDTRIP
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("large.pna");
        let output_dir = temp.path().join("parts");
        let restored = temp.path().join("restored.pna");
        let payload = vec![42_u8; 4096];
        write_archive(&archive_path, &[("payload.bin", &payload)], None);
        let original_hash = Sha256::digest(fs::read(&archive_path).unwrap());

        let split = split_archive(
            &SplitRequest {
                archive_path: archive_path.clone(),
                output_directory: output_dir.clone(),
                max_part_bytes: 512,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert!(split.completed_items > 1);
        let parts = (1..=split.completed_items)
            .map(|part| output_dir.join(format!("large.part{part}.pna")))
            .collect::<Vec<_>>();
        assert!(parts.iter().all(|part| part.is_file()));

        concat_archives(
            &ConcatRequest {
                parts: vec![parts[1].clone()],
                output_path: restored.clone(),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(archive_names(&restored, None), vec!["payload.bin"]);
        assert_eq!(
            Sha256::digest(fs::read(&archive_path).unwrap()),
            original_hash
        );
    }

    #[test]
    fn split_progress_reports_source_entries_instead_of_fake_completion() {
        // BE-VOLUME-SPLIT-PROGRESS
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pna");
        write_archive(
            &source,
            &[("a.txt", b"a"), ("b.txt", b"b"), ("c.txt", b"c")],
            None,
        );
        let mut updates = Vec::new();

        split_archive(
            &SplitRequest {
                archive_path: source,
                output_directory: temp.path().join("parts"),
                max_part_bytes: 512,
            },
            || false,
            |completed, total, _| updates.push((completed, total)),
        )
        .unwrap();

        assert_eq!(updates, vec![(1, 3), (2, 3), (3, 3)]);
    }

    #[test]
    fn concat_discovers_numeric_order_and_rejects_duplicate_or_mixed_sets() {
        // BE-VOLUME-AUTO-DISCOVERY, BE-VOLUME-SELECTION-VALIDATION
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pna");
        write_archive(&source, &[("payload.bin", &vec![9_u8; 4096])], None);
        let split = split_archive(
            &SplitRequest {
                archive_path: source,
                output_directory: temp.path().join("parts"),
                max_part_bytes: 512,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert!(split.completed_items > 1);
        let part1 = temp.path().join("parts/source.part1.pna");
        let part2 = temp.path().join("parts/source.part2.pna");

        let duplicate = concat_archives(
            &ConcatRequest {
                parts: vec![part1.clone(), part1.clone()],
                output_path: temp.path().join("duplicate.pna"),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(duplicate.kind(), io::ErrorKind::InvalidInput);

        let other = temp.path().join("parts/other.part1.pna");
        fs::copy(&part1, &other).unwrap();
        let mixed = concat_archives(
            &ConcatRequest {
                parts: vec![part2, other],
                output_path: temp.path().join("mixed.pna"),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(mixed.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn split_cancellation_removes_every_partial_and_published_part() {
        // BE-VOLUME-CANCEL-CLEANUP
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pna");
        let output = temp.path().join("parts");
        write_archive(
            &source,
            &[("first.bin", &vec![1_u8; 4096]), ("second.bin", b"two")],
            None,
        );
        let original = fs::read(&source).unwrap();
        let cancelled = AtomicBool::new(false);

        let error = split_archive(
            &SplitRequest {
                archive_path: source.clone(),
                output_directory: output.clone(),
                max_part_bytes: 512,
            },
            || cancelled.load(Ordering::SeqCst),
            |_, _, _| cancelled.store(true, Ordering::SeqCst),
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert_eq!(fs::read(source).unwrap(), original);
        assert!(fs::read_dir(output).unwrap().next().is_none());
    }

    #[test]
    fn split_publication_failure_never_leaves_a_discoverable_prefix() {
        // BE-VOLUME-PUBLISH-FAILURE-NONDISCOVERABLE
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pna");
        let output = temp.path().join("parts");
        write_archive(&source, &[("large.bin", &vec![4_u8; 4096])], None);
        let raced_part = output.join("source.part2.pna");
        let mut raced = false;

        let error = split_archive(
            &SplitRequest {
                archive_path: source,
                output_directory: output.clone(),
                max_part_bytes: 512,
            },
            || false,
            |_, _, _| {
                if !raced {
                    fs::write(&raced_part, b"another process").unwrap();
                    raced = true;
                }
            },
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert!(!output.join("source.part1.pna").exists());
        let concat_error = concat_archives(
            &ConcatRequest {
                parts: vec![raced_part],
                output_path: temp.path().join("combined.pna"),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(concat_error.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn normalize_tools_write_separate_outputs_and_preserve_the_source() {
        // BE-NORMALIZE-SORT-STRIP-MIGRATE
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pna");
        write_archive(&source, &[("z.txt", b"z"), ("a.txt", b"a")], None);
        let original = fs::read(&source).unwrap();

        let sorted = temp.path().join("sorted.pna");
        sort_archive(
            &SortRequest {
                archive_path: source.clone(),
                output_path: sorted.clone(),
                password: None,
                descending: false,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            archive_names_in_storage_order(&sorted),
            vec!["a.txt", "z.txt"]
        );

        let stripped = temp.path().join("stripped.pna");
        strip_archive_metadata(
            &StripMetadataRequest {
                archive_path: source.clone(),
                output_path: stripped.clone(),
                password: None,
                keep_timestamps: false,
                keep_permissions: false,
                keep_xattrs: false,
                keep_private_chunks: false,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert!(stripped.is_file());

        let migrated = temp.path().join("migrated.pna");
        migrate_archive(
            &MigrateRequest {
                archive_path: source.clone(),
                output_path: migrated.clone(),
                password: None,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(archive_names(&migrated, None), vec!["a.txt", "z.txt"]);
        assert_eq!(fs::read(source).unwrap(), original);
    }

    #[test]
    fn strip_metadata_applies_each_preservation_boundary_exactly() {
        // BE-NORMALIZE-STRIP-EXACT
        let temp = tempdir().unwrap();
        let source = temp.path().join("metadata.pna");
        let file = fs::File::create(&source).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut builder = EntryBuilder::new_file("meta.txt".into(), WriteOptions::store()).unwrap();
        builder
            .created(Duration::seconds(123))
            .permission_mode(PermissionMode::from(0o640))
            .add_xattr(ExtendedAttribute::new(
                XattrName::try_from("user.pna-test").unwrap(),
                XattrValue::try_from(b"retained".as_slice()).unwrap(),
            ))
            .add_extra_chunk(RawChunk::from_data(
                ChunkType::private(*b"ptSt").unwrap(),
                b"private metadata".to_vec(),
            ));
        builder.write_all(b"content").unwrap();
        archive.add_entry(builder.build().unwrap()).unwrap();
        archive.finalize().unwrap();
        let original = fs::read(&source).unwrap();

        let removed = temp.path().join("removed.pna");
        strip_archive_metadata(
            &StripMetadataRequest {
                archive_path: source.clone(),
                output_path: removed.clone(),
                password: None,
                keep_timestamps: false,
                keep_permissions: false,
                keep_xattrs: false,
                keep_private_chunks: false,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        let removed = read_single_normal_entry(&removed);
        assert_eq!(removed.metadata().created(), None);
        assert_eq!(removed.metadata().permission_mode(), None);
        assert!(removed.xattrs().is_empty());
        assert!(removed.extra_chunks().is_empty());

        let retained = temp.path().join("retained.pna");
        strip_archive_metadata(
            &StripMetadataRequest {
                archive_path: source.clone(),
                output_path: retained.clone(),
                password: None,
                keep_timestamps: true,
                keep_permissions: true,
                keep_xattrs: true,
                keep_private_chunks: true,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        let retained = read_single_normal_entry(&retained);
        assert_eq!(retained.metadata().created(), Some(Duration::seconds(123)));
        assert_eq!(
            retained.metadata().permission_mode(),
            Some(PermissionMode::from(0o640))
        );
        assert_eq!(retained.xattrs().len(), 1);
        assert!(retained
            .extra_chunks()
            .iter()
            .any(|chunk| chunk.ty() == ChunkType::private(*b"ptSt").unwrap()));
        assert_eq!(fs::read(source).unwrap(), original);
    }

    #[test]
    fn normalization_cancellation_preserves_source_and_removes_output() {
        // BE-NORMALIZE-CANCEL-PRESERVES-SOURCE
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pna");
        let output = temp.path().join("normalized.pna");
        write_archive(&source, &[("a.txt", b"a"), ("b.txt", b"b")], None);
        let original = fs::read(&source).unwrap();
        let cancelled = AtomicBool::new(false);

        let error = migrate_archive(
            &MigrateRequest {
                archive_path: source.clone(),
                output_path: output.clone(),
                password: None,
            },
            || cancelled.load(Ordering::SeqCst),
            |_, _, _| cancelled.store(true, Ordering::SeqCst),
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert_eq!(fs::read(source).unwrap(), original);
        assert!(!output.exists());
        assert!(fs::read_dir(temp.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("partial")));
    }

    #[test]
    fn normalization_preserves_encrypted_solid_storage_and_rejects_wrong_password() {
        // BE-NORMALIZE-ENCRYPTED-SOLID
        let temp = tempdir().unwrap();
        let source = temp.path().join("secure.pna");
        write_solid_archive(&source, &[("z.txt", b"z"), ("a.txt", b"a")], "secret");
        let original = fs::read(&source).unwrap();

        let wrong_output = temp.path().join("wrong.pna");
        let wrong = sort_archive(
            &SortRequest {
                archive_path: source.clone(),
                output_path: wrong_output.clone(),
                password: Some("wrong".into()),
                descending: false,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert!(matches!(
            wrong.kind(),
            io::ErrorKind::InvalidData | io::ErrorKind::Other
        ));
        assert!(!wrong_output.exists());

        let sorted = temp.path().join("sorted.pna");
        sort_archive(
            &SortRequest {
                archive_path: source.clone(),
                output_path: sorted.clone(),
                password: Some("secret".into()),
                descending: false,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            archive_names_result(&sorted, Some("secret")).unwrap(),
            vec!["a.txt", "z.txt"]
        );

        let stripped = temp.path().join("stripped.pna");
        strip_archive_metadata(
            &StripMetadataRequest {
                archive_path: source.clone(),
                output_path: stripped.clone(),
                password: Some("secret".into()),
                keep_timestamps: false,
                keep_permissions: false,
                keep_xattrs: false,
                keep_private_chunks: false,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            archive_names(&stripped, Some("secret")),
            vec!["a.txt", "z.txt"]
        );

        let migrated = temp.path().join("migrated.pna");
        migrate_archive(
            &MigrateRequest {
                archive_path: source.clone(),
                output_path: migrated.clone(),
                password: Some("secret".into()),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            archive_names(&migrated, Some("secret")),
            vec!["a.txt", "z.txt"]
        );
        assert_eq!(fs::read(source).unwrap(), original);
    }

    #[test]
    fn sort_rejects_multiple_solid_groups_with_group_metadata() {
        // BE-NORMALIZE-SORT-SOLID-METADATA
        let temp = tempdir().unwrap();
        let source = temp.path().join("multiple-solid.pna");
        let file = fs::File::create(&source).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        for (name, marker) in [("a.txt", *b"aaAa"), ("b.txt", *b"bbBb")] {
            let mut group = SolidEntryBuilder::new(WriteOptions::store()).unwrap();
            group.add_extra_chunk(RawChunk::from_data(
                ChunkType::private(marker).unwrap(),
                vec![marker[0]],
            ));
            let mut entry =
                EntryBuilder::new_file(EntryName::from(name), WriteOptions::store()).unwrap();
            entry.write_all(name.as_bytes()).unwrap();
            group.add_entry(entry.build().unwrap()).unwrap();
            archive.add_entry(group.build().unwrap()).unwrap();
        }
        archive.finalize().unwrap();
        let output = temp.path().join("sorted.pna");

        let error = sort_archive(
            &SortRequest {
                archive_path: source,
                output_path: output.clone(),
                password: None,
                descending: false,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
        assert!(error.to_string().contains("metadata"));
        assert!(!output.exists());
    }

    fn read_single_normal_entry(path: &Path) -> NormalEntry {
        let file = fs::File::open(path).unwrap();
        let mut archive = Archive::read_header(file).unwrap();
        match archive.entries().next().unwrap().unwrap() {
            ReadEntry::Normal(entry) => entry,
            ReadEntry::Solid(_) => panic!("expected a normal entry"),
        }
    }

    fn archive_names_in_storage_order(path: &Path) -> Vec<String> {
        let file = fs::File::open(path).unwrap();
        let mut archive = Archive::read_header(file).unwrap();
        archive
            .entries_with_password(None)
            .map(|entry| entry.unwrap().name().to_string())
            .collect()
    }

    #[test]
    fn append_rejects_duplicates_and_cancellation_without_changing_the_archive() {
        // BE-UPDATE-APPEND-DUPLICATE, BE-UPDATE-APPEND-CANCEL-PRESERVES-SOURCE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("project.pna");
        let source = temp.path().join("same.txt");
        write_archive(&archive_path, &[("same.txt", b"old")], None);
        fs::write(&source, b"new").unwrap();
        let original = fs::read(&archive_path).unwrap();
        let duplicate = append_archive(
            &AppendRequest {
                archive_path: archive_path.clone(),
                sources: vec![source.clone()],
                options: standard_options(),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(duplicate.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&archive_path).unwrap(), original);

        let different = temp.path().join("different.txt");
        fs::write(&different, b"different").unwrap();
        let cancel = AtomicBool::new(false);
        let cancelled = append_archive(
            &AppendRequest {
                archive_path: archive_path.clone(),
                sources: vec![different],
                options: standard_options(),
            },
            || cancel.load(Ordering::Acquire),
            |_, _, _| cancel.store(true, Ordering::Release),
        )
        .unwrap_err();
        assert_eq!(cancelled.kind(), io::ErrorKind::Interrupted);
        assert_eq!(fs::read(&archive_path).unwrap(), original);
    }

    #[test]
    fn append_does_not_replace_an_archive_changed_by_another_writer() {
        // BE-UPDATE-APPEND-CONCURRENT-CHANGE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("project.pna");
        let source = temp.path().join("new.txt");
        write_archive(&archive_path, &[("old.txt", b"old")], None);
        fs::write(&source, b"new").unwrap();
        let external_contents = b"external writer owns this path";
        let mut changed = false;

        let error = append_archive(
            &AppendRequest {
                archive_path: archive_path.clone(),
                sources: vec![source],
                options: standard_options(),
            },
            || false,
            |_, _, _| {
                if !changed {
                    fs::write(&archive_path, external_contents).unwrap();
                    changed = true;
                }
            },
        )
        .unwrap_err();

        assert!(error.to_string().contains("changed"));
        assert_eq!(fs::read(&archive_path).unwrap(), external_contents);
    }

    #[test]
    fn encrypted_solid_updates_preserve_encryption_and_require_the_password() {
        // BE-UPDATE-ENCRYPTED-SOLID
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("secure.pna");
        write_solid_archive(&archive_path, &[("secret/a.txt", b"a")], "secret");
        let added = temp.path().join("b.txt");
        fs::write(&added, b"b").unwrap();
        let mut options = standard_options();
        options.solid = true;
        options.encryption = CreateEncryption::Aes;
        options.password = Some("secret".into());
        append_archive(
            &AppendRequest {
                archive_path: archive_path.clone(),
                sources: vec![added],
                options,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            archive_names(&archive_path, Some("secret")),
            vec!["b.txt", "secret/a.txt"]
        );
        assert!(archive_names_result(&archive_path, Some("wrong")).is_err());

        rename_archive_entry(
            &RenameEntryRequest {
                archive_path: archive_path.clone(),
                source_path: "secret".into(),
                destination_path: "private".into(),
                password: Some("secret".into()),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            archive_names(&archive_path, Some("secret")),
            vec!["b.txt", "private/a.txt"]
        );
    }

    #[test]
    fn edit_validation_rejects_missing_and_colliding_targets_before_commit() {
        // BE-UPDATE-EDIT-MISSING, BE-UPDATE-RENAME-COLLISION
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("project.pna");
        write_archive(&archive_path, &[("a.txt", b"a"), ("b.txt", b"b")], None);
        let original = fs::read(&archive_path).unwrap();
        let missing = delete_archive_entries(
            &DeleteEntriesRequest {
                archive_path: archive_path.clone(),
                entries: vec!["missing".into()],
                password: None,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(missing.kind(), io::ErrorKind::NotFound);
        let collision = rename_archive_entry(
            &RenameEntryRequest {
                archive_path: archive_path.clone(),
                source_path: "a.txt".into(),
                destination_path: "b.txt".into(),
                password: None,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(collision.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(archive_path).unwrap(), original);
    }

    #[test]
    fn edit_and_normalization_progress_report_the_verified_logical_total() {
        // BE-UPDATE-PROGRESS-TRUTHFUL, BE-NORMALIZE-PROGRESS-TRUTHFUL
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("project.pna");
        write_archive(
            &archive_path,
            &[("a.txt", b"a"), ("b.txt", b"b"), ("c.txt", b"c")],
            None,
        );
        let edit_progress = std::sync::Mutex::new(Vec::new());
        rename_archive_entry(
            &RenameEntryRequest {
                archive_path: archive_path.clone(),
                source_path: "a.txt".into(),
                destination_path: "renamed.txt".into(),
                password: None,
            },
            || false,
            |completed, total, _| edit_progress.lock().unwrap().push((completed, total)),
        )
        .unwrap();
        assert_eq!(*edit_progress.lock().unwrap(), vec![(1, 3), (2, 3), (3, 3)]);

        let normalize_progress = std::sync::Mutex::new(Vec::new());
        migrate_archive(
            &MigrateRequest {
                archive_path,
                output_path: temp.path().join("migrated.pna"),
                password: None,
            },
            || false,
            |completed, total, _| {
                normalize_progress.lock().unwrap().push((completed, total));
            },
        )
        .unwrap();
        assert_eq!(
            *normalize_progress.lock().unwrap(),
            vec![(1, 3), (2, 3), (3, 3)]
        );
    }

    #[test]
    fn volume_preflight_rejects_invalid_size_existing_output_and_missing_parts() {
        // BE-VOLUME-PREFLIGHT-FAILURES
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pna");
        let payload = vec![7_u8; 4096];
        write_archive(&source, &[("a.txt", &payload)], None);
        let too_small = split_archive(
            &SplitRequest {
                archive_path: source.clone(),
                output_directory: temp.path().join("parts"),
                max_part_bytes: 1,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(too_small.kind(), io::ErrorKind::InvalidInput);

        let output = temp.path().join("output.pna");
        fs::write(&output, b"keep").unwrap();
        let single_part = temp.path().join("source.part1.pna");
        fs::copy(&source, &single_part).unwrap();
        let existing = concat_archives(
            &ConcatRequest {
                parts: vec![single_part],
                output_path: output.clone(),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(existing.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&output).unwrap(), b"keep");

        let split_dir = temp.path().join("split");
        let split = split_archive(
            &SplitRequest {
                archive_path: source,
                output_directory: split_dir.clone(),
                max_part_bytes: 256,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();
        assert!(split.completed_items > 1);
        fs::remove_file(split_dir.join("source.part2.pna")).unwrap();
        let missing_output = temp.path().join("missing-output.pna");
        let error = concat_archives(
            &ConcatRequest {
                parts: vec![split_dir.join("source.part1.pna")],
                output_path: missing_output.clone(),
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert!(!missing_output.exists());
    }

    #[test]
    fn separate_output_publication_never_replaces_a_racing_destination() {
        // BE-OUTPUT-NOCLOBBER-RACE
        let temp = tempdir().unwrap();
        let partial = temp.path().join(".result.pna.partial-test");
        let output = temp.path().join("result.pna");
        fs::write(&partial, b"new archive").unwrap();
        fs::write(&output, b"racing owner").unwrap();

        let error = publish_new_output(&partial, &output).unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&output).unwrap(), b"racing owner");
        assert_eq!(fs::read(&partial).unwrap(), b"new archive");
    }

    fn write_solid_archive(path: &Path, entries: &[(&str, &[u8])], password: &str) {
        let options = WriteOptions::builder()
            .compression(libpna::Compression::ZStandard)
            .encryption(libpna::Encryption::Aes)
            .password(Some(password))
            .build();
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_solid_header(file, options).unwrap();
        for (name, content) in entries {
            let mut builder =
                EntryBuilder::new_file(EntryName::from(*name), WriteOptions::store()).unwrap();
            builder.write_all(content).unwrap();
            archive.add_entry(builder.build().unwrap()).unwrap();
        }
        archive.finalize().unwrap();
    }

    fn archive_names_result(path: &Path, password: Option<&str>) -> io::Result<Vec<String>> {
        let file = fs::File::open(path)?;
        let mut archive = Archive::read_header(file)?;
        archive
            .entries_with_password(password.map(str::as_bytes))
            .map(|entry| entry.map(|entry| entry.name().to_string()))
            .collect()
    }

    fn archive_names(path: &Path, password: Option<&str>) -> Vec<String> {
        let file = fs::File::open(path).unwrap();
        let mut archive = Archive::read_header(file).unwrap();
        let mut names = archive
            .entries_with_password(password.map(str::as_bytes))
            .map(|entry| entry.unwrap().name().to_string())
            .collect::<Vec<_>>();
        names.sort();
        names
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
