use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read},
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use libpna::{Archive, Chunk, DataKind, ReadOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompareSourceKind {
    Archive,
    Folder,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareSource {
    pub kind: CompareSourceKind,
    pub path: PathBuf,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRequest {
    pub left: CompareSource,
    pub right: CompareSource,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DifferenceKind {
    Same,
    Added,
    Removed,
    ContentChanged,
    MetadataChanged,
    ComparisonUnavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonItem {
    pub kind: String,
    pub size: Option<u64>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub accessed_at: Option<i64>,
    pub permission: Option<String>,
    pub owner: Option<String>,
    pub group: Option<String>,
    #[serde(default)]
    pub xattrs: Vec<String>,
    pub compression: Option<String>,
    pub encryption: Option<String>,
    pub content_sha256: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataDifference {
    pub field: String,
    pub left: Option<String>,
    pub right: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonDifference {
    pub path: String,
    pub kind: DifferenceKind,
    pub left: Option<ComparisonItem>,
    pub right: Option<ComparisonItem>,
    pub metadata_differences: Vec<MetadataDifference>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonSummary {
    pub total: u64,
    pub same: u64,
    pub added: u64,
    pub removed: u64,
    pub content_changed: u64,
    pub metadata_changed: u64,
    pub comparison_unavailable: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonSourceStamp {
    pub kind: CompareSourceKind,
    pub path: PathBuf,
    pub size: u64,
    pub modified_at: Option<i64>,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonReport {
    pub left: ComparisonSourceStamp,
    pub right: ComparisonSourceStamp,
    pub completed_at: i64,
    pub summary: ComparisonSummary,
    pub differences: Vec<ComparisonDifference>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonResult {
    pub left: ComparisonSourceStamp,
    pub right: ComparisonSourceStamp,
    pub completed_at: i64,
    pub summary: ComparisonSummary,
}

impl From<&ComparisonReport> for ComparisonResult {
    fn from(report: &ComparisonReport) -> Self {
        Self {
            left: report.left.clone(),
            right: report.right.clone(),
            completed_at: report.completed_at,
            summary: report.summary.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonPageRequest {
    pub job_id: String,
    #[serde(default)]
    pub kinds: Vec<DifferenceKind>,
    #[serde(default)]
    pub query: String,
    pub cursor: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonPage {
    pub items: Vec<ComparisonDifference>,
    pub next_cursor: Option<usize>,
    pub total_count: usize,
}

pub fn page_report(report: &ComparisonReport, request: &ComparisonPageRequest) -> ComparisonPage {
    let query = request.query.to_lowercase();
    let filtered = report
        .differences
        .iter()
        .filter(|difference| {
            (request.kinds.is_empty() || request.kinds.contains(&difference.kind))
                && (query.is_empty() || difference.path.to_lowercase().contains(&query))
        })
        .collect::<Vec<_>>();
    let start = request.cursor.unwrap_or(0).min(filtered.len());
    let limit = request.limit.unwrap_or(200).clamp(1, 1_000);
    let end = start.saturating_add(limit).min(filtered.len());
    ComparisonPage {
        items: filtered[start..end]
            .iter()
            .map(|difference| (*difference).clone())
            .collect(),
        next_cursor: (end < filtered.len()).then_some(end),
        total_count: filtered.len(),
    }
}

pub fn compare_sources<C, P>(
    request: &CompareRequest,
    cancelled: C,
    mut progress: P,
) -> io::Result<ComparisonReport>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    check_cancelled(&cancelled)?;
    let (left_stamp, left_items) = read_source(&request.left, &cancelled)?;
    progress(1, 2, &request.left.path.to_string_lossy());
    check_cancelled(&cancelled)?;
    let (right_stamp, right_items) = read_source(&request.right, &cancelled)?;
    progress(2, 2, &request.right.path.to_string_lossy());
    ensure_source_unchanged(&request.left, &left_stamp, &cancelled)?;
    ensure_source_unchanged(&request.right, &right_stamp, &cancelled)?;

    let mut paths = left_items
        .keys()
        .chain(right_items.keys())
        .cloned()
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    let differences = paths
        .into_iter()
        .map(|path| classify_difference(path, &left_items, &right_items))
        .collect::<Vec<_>>();
    let summary = summarize(&differences);

    Ok(ComparisonReport {
        left: left_stamp,
        right: right_stamp,
        completed_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64,
        summary,
        differences,
    })
}

fn ensure_source_unchanged<C>(
    source: &CompareSource,
    expected: &ComparisonSourceStamp,
    cancelled: &C,
) -> io::Result<()>
where
    C: Fn() -> bool,
{
    check_cancelled(cancelled)?;
    let current = match source.kind {
        CompareSourceKind::Archive => archive_stamp(source)?,
        CompareSourceKind::Folder => scan_folder(source, cancelled)?.0,
    };
    if current.sha256 != expected.sha256 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "a comparison source changed while it was being read",
        ));
    }
    Ok(())
}

fn read_source<C>(
    source: &CompareSource,
    cancelled: &C,
) -> io::Result<(ComparisonSourceStamp, BTreeMap<String, ComparisonItem>)>
where
    C: Fn() -> bool,
{
    match source.kind {
        CompareSourceKind::Archive => read_archive(source, cancelled),
        CompareSourceKind::Folder => read_folder(source, cancelled),
    }
}

fn read_folder<C>(
    source: &CompareSource,
    cancelled: &C,
) -> io::Result<(ComparisonSourceStamp, BTreeMap<String, ComparisonItem>)>
where
    C: Fn() -> bool,
{
    let (before, items) = scan_folder(source, cancelled)?;
    let (after, _) = scan_folder(source, cancelled)?;
    if before.sha256 != after.sha256 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "a comparison source changed while it was being read",
        ));
    }
    Ok((after, items))
}

fn scan_folder<C>(
    source: &CompareSource,
    cancelled: &C,
) -> io::Result<(ComparisonSourceStamp, BTreeMap<String, ComparisonItem>)>
where
    C: Fn() -> bool,
{
    let root_metadata = fs::metadata(&source.path)?;
    if !root_metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a folder comparison source must be a directory",
        ));
    }
    let mut pending = vec![source.path.clone()];
    let mut items = BTreeMap::new();
    while let Some(directory) = pending.pop() {
        check_cancelled(cancelled)?;
        let mut children = fs::read_dir(&directory)?.collect::<Result<Vec<_>, _>>()?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            check_cancelled(cancelled)?;
            let path = child.path();
            let metadata = fs::symlink_metadata(&path)?;
            let relative = path
                .strip_prefix(&source.path)
                .map_err(io::Error::other)?
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            let file_type = metadata.file_type();
            let (kind, content_sha256) = if file_type.is_file() {
                ("file", Some(sha256_file_with_cancel(&path, cancelled)?))
            } else if file_type.is_dir() {
                pending.push(path.clone());
                ("directory", None)
            } else if file_type.is_symlink() {
                ("symbolic_link", None)
            } else {
                ("unsupported", None)
            };
            items.insert(
                relative,
                ComparisonItem {
                    kind: kind.into(),
                    size: file_type.is_file().then_some(metadata.len()),
                    created_at: metadata
                        .created()
                        .ok()
                        .and_then(system_time_to_unix_seconds),
                    modified_at: metadata
                        .modified()
                        .ok()
                        .and_then(system_time_to_unix_seconds),
                    accessed_at: metadata
                        .accessed()
                        .ok()
                        .and_then(system_time_to_unix_seconds),
                    permission: permission_string(&metadata),
                    owner: owner_string(&metadata),
                    group: group_string(&metadata),
                    xattrs: Vec::new(),
                    compression: Some("No".into()),
                    encryption: Some("No".into()),
                    content_sha256,
                },
            );
        }
    }
    let mut size = 0_u64;
    for item in items.values() {
        size = size.saturating_add(item.size.unwrap_or(0));
    }
    Ok((
        ComparisonSourceStamp {
            kind: CompareSourceKind::Folder,
            path: source.path.clone(),
            size,
            modified_at: root_metadata
                .modified()
                .ok()
                .and_then(system_time_to_unix_seconds),
            sha256: folder_content_digest(&items),
        },
        items,
    ))
}

fn folder_content_digest(items: &BTreeMap<String, ComparisonItem>) -> String {
    let mut digest = Sha256::new();
    for (path, item) in items {
        digest.update(path.as_bytes());
        digest.update([0]);
        digest.update(item.kind.as_bytes());
        digest.update([0]);
        digest.update(item.size.unwrap_or(0).to_le_bytes());
        if let Some(modified_at) = item.modified_at {
            digest.update([1]);
            digest.update(modified_at.to_le_bytes());
        } else {
            digest.update([0]);
        }
        if let Some(permission) = item.permission.as_deref() {
            digest.update([1]);
            digest.update(permission.as_bytes());
        } else {
            digest.update([0]);
        }
        // Reading a file for hashing may update its access time. Access time is
        // still reported as comparable metadata, but it must not participate in
        // the mutation guard or an unchanged folder can invalidate its own scan.
        for value in [
            item.created_at.map(|value| value.to_string()),
            item.owner.clone(),
            item.group.clone(),
        ] {
            if let Some(value) = value {
                digest.update([1]);
                digest.update(value.as_bytes());
            } else {
                digest.update([0]);
            }
        }
        for xattr in &item.xattrs {
            digest.update(xattr.as_bytes());
            digest.update([0]);
        }
        if let Some(hash) = item.content_sha256.as_deref() {
            digest.update(hash.as_bytes());
        }
    }
    format!("{:x}", digest.finalize())
}

fn sha256_file_with_cancel(path: &PathBuf, cancelled: &impl Fn() -> bool) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        check_cancelled(cancelled)?;
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(unix)]
fn permission_string(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    Some(format!("{:04o}", metadata.permissions().mode() & 0o7777))
}

#[cfg(unix)]
fn owner_string(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(metadata.uid().to_string())
}

#[cfg(not(unix))]
fn owner_string(_: &fs::Metadata) -> Option<String> {
    None
}

#[cfg(unix)]
fn group_string(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(metadata.gid().to_string())
}

#[cfg(not(unix))]
fn group_string(_: &fs::Metadata) -> Option<String> {
    None
}

#[cfg(not(unix))]
fn permission_string(metadata: &fs::Metadata) -> Option<String> {
    Some(
        if metadata.permissions().readonly() {
            "readonly"
        } else {
            "writable"
        }
        .into(),
    )
}

fn read_archive<C>(
    source: &CompareSource,
    cancelled: &C,
) -> io::Result<(ComparisonSourceStamp, BTreeMap<String, ComparisonItem>)>
where
    C: Fn() -> bool,
{
    let before = archive_stamp(source)?;
    let mut archive = Archive::read_header(fs::File::open(&source.path)?)?;
    let mut items = BTreeMap::new();
    for entry in archive.entries_with_password(source.password.as_deref().map(str::as_bytes)) {
        check_cancelled(cancelled)?;
        let entry = entry?;
        let path = entry.header().path().as_str().replace('\\', "/");
        crate::safe_relative_entry_path(entry.header().path().as_path())?;
        let metadata = entry.metadata();
        let data_kind = entry.header().data_kind();
        let encrypted_store_without_integrity = data_kind == DataKind::File
            && entry.header().encryption() != libpna::Encryption::No
            && entry.header().compression() == libpna::Compression::No
            && entry.extra_chunks().iter().all(|chunk| {
                chunk.ty()
                    != libpna::ChunkType::private(crate::operations::PLAINTEXT_DIGEST_CHUNK_BYTES)
                        .expect("the plaintext digest chunk type is valid")
            });
        let content_sha256 = if encrypted_store_without_integrity {
            None
        } else if data_kind == DataKind::File {
            let mut reader =
                entry.reader(ReadOptions::with_password(source.password.as_deref()))?;
            let mut digest = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                check_cancelled(cancelled)?;
                let read = reader.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                digest.update(&buffer[..read]);
            }
            let digest = digest.finalize();
            if entry.header().encryption() != libpna::Encryption::No
                && entry.header().compression() == libpna::Compression::No
            {
                let expected = entry
                    .extra_chunks()
                    .iter()
                    .find(|chunk| {
                        chunk.ty()
                            == libpna::ChunkType::private(
                                crate::operations::PLAINTEXT_DIGEST_CHUNK_BYTES,
                            )
                            .expect("the plaintext digest chunk type is valid")
                    })
                    .map(|chunk| chunk.data())
                    .expect("encrypted store content was checked for an integrity digest");
                if digest.as_slice() != expected {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "the archive password did not produce verifiable plaintext",
                    ));
                }
            }
            Some(format!("{digest:x}"))
        } else {
            None
        };
        let item = ComparisonItem {
            kind: data_kind_name(data_kind).into(),
            size: metadata
                .raw_file_size()
                .and_then(|size| u64::try_from(size).ok()),
            created_at: metadata.created().map(|value| value.whole_seconds()),
            modified_at: metadata.modified().map(|value| value.whole_seconds()),
            accessed_at: metadata.accessed().map(|value| value.whole_seconds()),
            permission: metadata
                .permission_mode()
                .map(|value| format!("{:04o}", value.get())),
            owner: archive_owner(metadata),
            group: archive_group(metadata),
            xattrs: entry
                .xattrs()
                .iter()
                .map(|attribute| {
                    format!(
                        "{}:{:x}",
                        attribute.name(),
                        Sha256::digest(attribute.value())
                    )
                })
                .collect(),
            compression: Some(format!("{:?}", entry.header().compression())),
            encryption: Some(format!("{:?}", entry.header().encryption())),
            content_sha256,
        };
        if items.insert(path.clone(), item).is_some() {
            items.insert(
                path,
                ComparisonItem {
                    kind: "duplicate".into(),
                    size: None,
                    created_at: None,
                    modified_at: None,
                    accessed_at: None,
                    permission: None,
                    owner: None,
                    group: None,
                    xattrs: Vec::new(),
                    compression: None,
                    encryption: None,
                    content_sha256: None,
                },
            );
        }
    }
    let after = archive_stamp(source)?;
    if before.sha256 != after.sha256 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "a comparison source changed while it was being read",
        ));
    }
    Ok((after, items))
}

fn archive_owner(metadata: &libpna::Metadata) -> Option<String> {
    match (metadata.owner_user_name(), metadata.owner_uid()) {
        (Some(name), Some(id)) if !name.as_str().is_empty() => {
            Some(format!("{} ({})", name.as_str(), id.get()))
        }
        (Some(name), _) if !name.as_str().is_empty() => Some(name.as_str().into()),
        (_, Some(id)) => Some(id.get().to_string()),
        _ => None,
    }
}

fn archive_group(metadata: &libpna::Metadata) -> Option<String> {
    match (metadata.owner_group_name(), metadata.owner_gid()) {
        (Some(name), Some(id)) if !name.as_str().is_empty() => {
            Some(format!("{} ({})", name.as_str(), id.get()))
        }
        (Some(name), _) if !name.as_str().is_empty() => Some(name.as_str().into()),
        (_, Some(id)) => Some(id.get().to_string()),
        _ => None,
    }
}

fn archive_stamp(source: &CompareSource) -> io::Result<ComparisonSourceStamp> {
    let metadata = fs::metadata(&source.path)?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "an archive comparison source must be a file",
        ));
    }
    let mut file = fs::File::open(&source.path)?;
    let mut digest = Sha256::new();
    io::copy(&mut file, &mut digest)?;
    Ok(ComparisonSourceStamp {
        kind: CompareSourceKind::Archive,
        path: source.path.clone(),
        size: metadata.len(),
        modified_at: metadata
            .modified()
            .ok()
            .and_then(system_time_to_unix_seconds),
        sha256: format!("{:x}", digest.finalize()),
    })
}

fn classify_difference(
    path: String,
    left_items: &BTreeMap<String, ComparisonItem>,
    right_items: &BTreeMap<String, ComparisonItem>,
) -> ComparisonDifference {
    let left = left_items.get(&path).cloned();
    let right = right_items.get(&path).cloned();
    let unavailable_kind = left
        .as_ref()
        .filter(|item| item_is_unavailable(item))
        .or_else(|| right.as_ref().filter(|item| item_is_unavailable(item)));
    let (kind, metadata_differences, detail) = if let Some(item) = unavailable_kind {
        (
            DifferenceKind::ComparisonUnavailable,
            match (&left, &right) {
                (Some(left), Some(right)) => metadata_differences(left, right),
                _ => Vec::new(),
            },
            Some(if item.kind == "duplicate" {
                "The source contains a duplicate entry path.".into()
            } else {
                format!("The {} entry type is not compared.", item.kind)
            }),
        )
    } else {
        match (&left, &right) {
            (None, Some(_)) => (DifferenceKind::Added, Vec::new(), None),
            (Some(_), None) => (DifferenceKind::Removed, Vec::new(), None),
            (Some(left), Some(right)) if left.kind != right.kind => (
                DifferenceKind::ContentChanged,
                metadata_differences(left, right),
                Some("The entry type differs between A and B.".into()),
            ),
            (Some(left), Some(right)) if left.kind == "file" => {
                if left.content_sha256.is_none() || right.content_sha256.is_none() {
                    (
                        DifferenceKind::ComparisonUnavailable,
                        metadata_differences(left, right),
                        Some("File content could not be compared.".into()),
                    )
                } else if left.content_sha256 != right.content_sha256 {
                    (
                        DifferenceKind::ContentChanged,
                        metadata_differences(left, right),
                        None,
                    )
                } else {
                    let metadata = metadata_differences(left, right);
                    (
                        if metadata.is_empty() {
                            DifferenceKind::Same
                        } else {
                            DifferenceKind::MetadataChanged
                        },
                        metadata,
                        None,
                    )
                }
            }
            (Some(left), Some(right)) => {
                let metadata = metadata_differences(left, right);
                (
                    if metadata.is_empty() {
                        DifferenceKind::Same
                    } else {
                        DifferenceKind::MetadataChanged
                    },
                    metadata,
                    None,
                )
            }
            (None, None) => unreachable!("the path originated from one source"),
        }
    };
    ComparisonDifference {
        path,
        kind,
        left,
        right,
        metadata_differences,
        detail,
    }
}

fn item_is_unavailable(item: &ComparisonItem) -> bool {
    matches!(
        item.kind.as_str(),
        "duplicate" | "symbolic_link" | "hard_link" | "unsupported" | "reserved" | "private"
    )
}

fn metadata_differences(left: &ComparisonItem, right: &ComparisonItem) -> Vec<MetadataDifference> {
    let mut differences = Vec::new();
    push_metadata_difference(
        &mut differences,
        "created_at",
        left.created_at.map(|value| value.to_string()),
        right.created_at.map(|value| value.to_string()),
    );
    push_metadata_difference(
        &mut differences,
        "modified_at",
        left.modified_at.map(|value| value.to_string()),
        right.modified_at.map(|value| value.to_string()),
    );
    push_metadata_difference(
        &mut differences,
        "accessed_at",
        left.accessed_at.map(|value| value.to_string()),
        right.accessed_at.map(|value| value.to_string()),
    );
    push_metadata_difference(
        &mut differences,
        "permission",
        left.permission.clone(),
        right.permission.clone(),
    );
    push_metadata_difference(
        &mut differences,
        "owner",
        left.owner.clone(),
        right.owner.clone(),
    );
    push_metadata_difference(
        &mut differences,
        "group",
        left.group.clone(),
        right.group.clone(),
    );
    push_metadata_difference(
        &mut differences,
        "extended_attributes",
        (!left.xattrs.is_empty()).then(|| left.xattrs.join(", ")),
        (!right.xattrs.is_empty()).then(|| right.xattrs.join(", ")),
    );
    push_metadata_difference(
        &mut differences,
        "compression",
        left.compression.clone(),
        right.compression.clone(),
    );
    push_metadata_difference(
        &mut differences,
        "encryption",
        left.encryption.clone(),
        right.encryption.clone(),
    );
    differences
}

fn push_metadata_difference(
    differences: &mut Vec<MetadataDifference>,
    field: &str,
    left: Option<String>,
    right: Option<String>,
) {
    if left != right {
        differences.push(MetadataDifference {
            field: field.into(),
            left,
            right,
        });
    }
}

fn summarize(differences: &[ComparisonDifference]) -> ComparisonSummary {
    let mut summary = ComparisonSummary {
        total: differences.len() as u64,
        ..ComparisonSummary::default()
    };
    for difference in differences {
        match difference.kind {
            DifferenceKind::Same => summary.same += 1,
            DifferenceKind::Added => summary.added += 1,
            DifferenceKind::Removed => summary.removed += 1,
            DifferenceKind::ContentChanged => summary.content_changed += 1,
            DifferenceKind::MetadataChanged => summary.metadata_changed += 1,
            DifferenceKind::ComparisonUnavailable => summary.comparison_unavailable += 1,
        }
    }
    summary
}

fn data_kind_name(kind: DataKind) -> &'static str {
    match kind {
        DataKind::File => "file",
        DataKind::Directory => "directory",
        DataKind::SymbolicLink => "symbolic_link",
        DataKind::HardLink => "hard_link",
        DataKind::Reserved(_) => "reserved",
        DataKind::Private(_) => "private",
    }
}

fn check_cancelled(cancelled: &impl Fn() -> bool) -> io::Result<()> {
    if cancelled() {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "comparison cancelled",
        ))
    } else {
        Ok(())
    }
}

fn system_time_to_unix_seconds(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        path::Path,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use libpna::{EntryBuilder, EntryName, EntryReference, WriteOptions};
    use tempfile::tempdir;

    use super::*;

    fn write_archive(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        for (name, contents) in entries {
            let mut entry =
                EntryBuilder::new_file(EntryName::from(*name), WriteOptions::store()).unwrap();
            entry.write_all(contents).unwrap();
            archive.add_entry(entry.build().unwrap()).unwrap();
        }
        archive.finalize().unwrap();
    }

    fn file_sha256(path: &Path) -> String {
        format!("{:x}", Sha256::digest(fs::read(path).unwrap()))
    }

    fn generated_test_password() -> String {
        let mut password = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        password.push_str(&std::process::id().to_string());
        password
    }

    fn write_encrypted_archive(path: &Path, password: &str, compressed: bool, with_digest: bool) {
        let contents = b"encrypted comparison payload";
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut builder = WriteOptions::builder();
        builder
            .encryption(libpna::Encryption::Aes)
            .password(Some(password));
        if compressed {
            builder.compression(libpna::Compression::ZStandard);
        }
        let mut entry =
            EntryBuilder::new_file(EntryName::from("secret.txt"), builder.build()).unwrap();
        entry.write_all(contents).unwrap();
        if with_digest {
            entry.add_extra_chunk(libpna::RawChunk::from_data(
                libpna::ChunkType::private(crate::operations::PLAINTEXT_DIGEST_CHUNK_BYTES)
                    .unwrap(),
                Sha256::digest(contents).to_vec(),
            ));
        }
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }

    fn write_encrypted_solid(path: &Path, password: &str) {
        let file = fs::File::create(path).unwrap();
        let options = WriteOptions::builder()
            .compression(libpna::Compression::ZStandard)
            .encryption(libpna::Encryption::Aes)
            .password(Some(password))
            .build();
        let mut archive = Archive::write_solid_header(file, options).unwrap();
        let mut entry =
            EntryBuilder::new_file(EntryName::from("solid.txt"), WriteOptions::store()).unwrap();
        entry.write_all(b"solid comparison payload").unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }

    fn write_duplicate_path_archive(path: &Path) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        for contents in [b"first".as_slice(), b"second".as_slice()] {
            let mut entry =
                EntryBuilder::new_file(EntryName::from("duplicate.txt"), WriteOptions::store())
                    .unwrap();
            entry.write_all(contents).unwrap();
            archive.add_entry(entry.build().unwrap()).unwrap();
        }
        archive.finalize().unwrap();
    }

    fn write_symlink_archive(path: &Path) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let entry =
            EntryBuilder::new_symlink(EntryName::from("link"), EntryReference::from("../outside"))
                .unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }

    fn write_archive_with_permission(path: &Path, permission: u16) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut entry =
            EntryBuilder::new_file(EntryName::from("meta.txt"), WriteOptions::store()).unwrap();
        entry.permission_mode(libpna::PermissionMode::from(permission));
        entry.write_all(b"same content").unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }

    #[test]
    fn compares_real_archives_without_modifying_either_source() {
        // BE-COMPARE-ARCHIVE-ARCHIVE-CLASSIFICATION,
        // BE-COMPARE-SOURCES-READ-ONLY
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        write_archive(
            &left,
            &[
                ("same.txt", b"same"),
                ("removed.txt", b"left only"),
                ("changed.txt", b"before"),
            ],
        );
        write_archive(
            &right,
            &[
                ("same.txt", b"same"),
                ("added.txt", b"right only"),
                ("changed.txt", b"after"),
            ],
        );
        let before_left = file_sha256(&left);
        let before_right = file_sha256(&right);

        let report = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left.clone(),
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right.clone(),
                    password: None,
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.summary.total, 4);
        assert_eq!(report.summary.same, 1);
        assert_eq!(report.summary.added, 1);
        assert_eq!(report.summary.removed, 1);
        assert_eq!(report.summary.content_changed, 1);
        let kinds = report
            .differences
            .iter()
            .map(|difference| (difference.path.as_str(), difference.kind))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(kinds["same.txt"], DifferenceKind::Same);
        assert_eq!(kinds["added.txt"], DifferenceKind::Added);
        assert_eq!(kinds["removed.txt"], DifferenceKind::Removed);
        assert_eq!(kinds["changed.txt"], DifferenceKind::ContentChanged);
        assert_eq!(file_sha256(&left), before_left);
        assert_eq!(file_sha256(&right), before_right);
    }

    #[test]
    fn compares_an_archive_with_a_folder_using_relative_paths() {
        // BE-COMPARE-ARCHIVE-FOLDER-CLASSIFICATION
        let temp = tempdir().unwrap();
        let archive = temp.path().join("left.pna");
        let folder = temp.path().join("right");
        fs::create_dir(&folder).unwrap();
        write_archive(
            &archive,
            &[("docs/same.txt", b"same"), ("removed.txt", b"removed")],
        );
        fs::create_dir(folder.join("docs")).unwrap();
        fs::write(folder.join("docs/same.txt"), b"same").unwrap();
        fs::write(folder.join("added.txt"), b"added").unwrap();
        let before_archive = file_sha256(&archive);

        let report = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: archive.clone(),
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Folder,
                    path: folder.clone(),
                    password: None,
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        let kinds = report
            .differences
            .iter()
            .map(|difference| (difference.path.as_str(), difference.kind))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(kinds["docs/same.txt"], DifferenceKind::MetadataChanged);
        assert_eq!(kinds["removed.txt"], DifferenceKind::Removed);
        assert_eq!(kinds["added.txt"], DifferenceKind::Added);
        assert_eq!(file_sha256(&archive), before_archive);
        assert_eq!(fs::read(folder.join("docs/same.txt")).unwrap(), b"same");
    }

    #[test]
    fn folder_mutation_guard_ignores_access_time_changed_by_its_own_read() {
        // BE-COMPARE-FOLDER-ACCESS-TIME-DETERMINISTIC
        let mut before = BTreeMap::from([(
            "document.txt".into(),
            ComparisonItem {
                kind: "file".into(),
                size: Some(7),
                created_at: Some(10),
                modified_at: Some(20),
                accessed_at: Some(30),
                permission: Some("0644".into()),
                owner: Some("501".into()),
                group: Some("20".into()),
                xattrs: Vec::new(),
                compression: Some("No".into()),
                encryption: Some("No".into()),
                content_sha256: Some(format!("{:x}", Sha256::digest(b"content"))),
            },
        )]);
        let first = folder_content_digest(&before);
        before.get_mut("document.txt").unwrap().accessed_at = Some(31);

        assert_eq!(folder_content_digest(&before), first);

        before.get_mut("document.txt").unwrap().modified_at = Some(21);
        assert_ne!(folder_content_digest(&before), first);
    }

    #[test]
    fn unchanged_archive_and_folder_comparison_is_repeatable() {
        // BE-COMPARE-FOLDER-REPEATABLE
        let temp = tempdir().unwrap();
        let archive = temp.path().join("left.pna");
        let folder = temp.path().join("right");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("same.txt"), b"same").unwrap();
        write_archive(&archive, &[("same.txt", b"same")]);
        let request = CompareRequest {
            left: CompareSource {
                kind: CompareSourceKind::Archive,
                path: archive,
                password: None,
            },
            right: CompareSource {
                kind: CompareSourceKind::Folder,
                path: folder,
                password: None,
            },
        };

        let reports = (0..10)
            .map(|_| compare_sources(&request, || false, |_, _, _| {}).unwrap())
            .collect::<Vec<_>>();

        assert!(reports
            .windows(2)
            .all(|pair| pair[0].summary == pair[1].summary));
        assert!(reports
            .windows(2)
            .all(|pair| pair[0].right.sha256 == pair[1].right.sha256));
    }

    #[test]
    fn encrypted_store_without_integrity_is_reported_as_unavailable() {
        // BE-COMPARE-ENCRYPTED-STORE-UNVERIFIABLE
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        let password = generated_test_password();
        write_encrypted_archive(&left, &password, false, false);
        write_encrypted_archive(&right, &password, false, false);

        let report = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: Some(password.clone()),
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: Some(password),
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.summary.comparison_unavailable, 1);
        assert_eq!(
            report.differences[0].kind,
            DifferenceKind::ComparisonUnavailable
        );
    }

    #[test]
    fn encrypted_store_digest_rejects_a_wrong_password() {
        // BE-COMPARE-ENCRYPTED-WRONG-PASSWORD
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        let password = generated_test_password();
        let wrong_password = format!("{password}{password}");
        write_encrypted_archive(&left, &password, false, true);
        write_encrypted_archive(&right, &password, false, true);

        let error = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: Some(wrong_password.clone()),
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: Some(wrong_password),
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn compares_encrypted_solid_archives_with_the_explicit_password() {
        // BE-COMPARE-ENCRYPTED-SOLID
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        let password = generated_test_password();
        write_encrypted_solid(&left, &password);
        write_encrypted_solid(&right, &password);

        let report = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: Some(password.clone()),
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: Some(password),
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.summary.same, 1);
        assert_eq!(report.differences[0].path, "solid.txt");
    }

    #[test]
    fn encrypted_archive_requires_an_explicit_password_before_comparison() {
        // BE-COMPARE-ENCRYPTED-PASSWORD-REQUIRED
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        let password = generated_test_password();
        write_encrypted_solid(&left, &password);
        write_encrypted_solid(&right, &password);

        let error = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: None,
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(error.to_string().contains("password"));
    }

    #[test]
    fn duplicate_archive_paths_are_never_silently_collapsed() {
        // BE-COMPARE-DUPLICATE-PATH
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        write_duplicate_path_archive(&left);
        write_duplicate_path_archive(&right);

        let report = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: None,
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.summary.comparison_unavailable, 1);
        assert!(report.differences[0]
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("duplicate"));
    }

    #[test]
    fn link_entries_are_explicitly_unavailable_instead_of_reported_same() {
        // BE-COMPARE-LINK-UNAVAILABLE
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        write_symlink_archive(&left);
        write_symlink_archive(&right);

        let report = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: None,
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.summary.comparison_unavailable, 1);
        assert_eq!(
            report.differences[0].kind,
            DifferenceKind::ComparisonUnavailable
        );
    }

    #[test]
    fn cancellation_stops_comparison_before_a_result_is_published() {
        // BE-COMPARE-CANCEL
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        write_archive(&left, &[("file.txt", b"left")]);
        write_archive(&right, &[("file.txt", b"right")]);
        let checks = AtomicUsize::new(0);

        let error = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: None,
                },
            },
            || checks.fetch_add(1, Ordering::SeqCst) >= 1,
            |_, _, _| {},
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    }

    #[test]
    fn rejects_a_source_changed_after_its_scan_but_before_completion() {
        // BE-COMPARE-SOURCE-MUTATED-MID-RUN
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        write_archive(&left, &[("file.txt", b"left")]);
        write_archive(&right, &[("file.txt", b"right")]);
        let left_to_mutate = left.clone();

        let error = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: None,
                },
            },
            || false,
            |completed, _, _| {
                if completed == 1 {
                    fs::OpenOptions::new()
                        .append(true)
                        .open(&left_to_mutate)
                        .unwrap()
                        .write_all(b"changed")
                        .unwrap();
                }
            },
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("changed"));
    }

    #[test]
    fn same_content_with_different_permissions_is_metadata_only() {
        // BE-COMPARE-METADATA-ONLY
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        write_archive_with_permission(&left, 0o640);
        write_archive_with_permission(&right, 0o600);

        let report = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: None,
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.summary.metadata_changed, 1);
        assert_eq!(
            report.differences[0].metadata_differences,
            vec![MetadataDifference {
                field: "permission".into(),
                left: Some("0640".into()),
                right: Some("0600".into()),
            }]
        );
    }

    #[test]
    fn comparison_paths_preserve_case_and_do_not_alias_case_variants() {
        // BE-COMPARE-PATH-CASE-PRESERVED
        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let right = temp.path().join("right.pna");
        write_archive(&left, &[("Readme.txt", b"upper"), ("readme.txt", b"lower")]);
        write_archive(
            &right,
            &[("Readme.txt", b"upper"), ("readme.txt", b"lower")],
        );

        let report = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: right,
                    password: None,
                },
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(
            report
                .differences
                .iter()
                .map(|difference| difference.path.as_str())
                .collect::<Vec<_>>(),
            vec!["Readme.txt", "readme.txt"]
        );
    }

    #[test]
    fn pages_and_filters_large_reports_without_truncating_paths() {
        // BE-COMPARE-PAGED-FILTERED-RESULTS
        let differences = (0..2_050)
            .map(|index| ComparisonDifference {
                path: format!("deep/folder/item-{index:04}.txt"),
                kind: if index % 2 == 0 {
                    DifferenceKind::Added
                } else {
                    DifferenceKind::Removed
                },
                left: None,
                right: None,
                metadata_differences: Vec::new(),
                detail: None,
            })
            .collect::<Vec<_>>();
        let report = ComparisonReport {
            left: ComparisonSourceStamp {
                kind: CompareSourceKind::Archive,
                path: "a.pna".into(),
                size: 0,
                modified_at: None,
                sha256: "a".into(),
            },
            right: ComparisonSourceStamp {
                kind: CompareSourceKind::Archive,
                path: "b.pna".into(),
                size: 0,
                modified_at: None,
                sha256: "b".into(),
            },
            completed_at: 0,
            summary: summarize(&differences),
            differences,
        };

        let page = page_report(
            &report,
            &ComparisonPageRequest {
                job_id: "job-1".into(),
                kinds: vec![DifferenceKind::Added],
                query: "ITEM-20".into(),
                cursor: None,
                limit: Some(10),
            },
        );

        assert_eq!(page.items.len(), 10);
        assert_eq!(page.total_count, 25);
        assert_eq!(page.next_cursor, Some(10));
        assert!(page
            .items
            .iter()
            .all(|item| item.path.starts_with("deep/folder/item-20")));
    }

    #[cfg(unix)]
    #[test]
    fn folder_metadata_change_during_comparison_invalidates_the_result() {
        // BE-COMPARE-FOLDER-METADATA-MUTATED
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let left = temp.path().join("left.pna");
        let folder = temp.path().join("right");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("file.txt"), b"same").unwrap();
        write_archive(&left, &[("file.txt", b"same")]);
        let file_to_mutate = folder.join("file.txt");

        let error = compare_sources(
            &CompareRequest {
                left: CompareSource {
                    kind: CompareSourceKind::Archive,
                    path: left,
                    password: None,
                },
                right: CompareSource {
                    kind: CompareSourceKind::Folder,
                    path: folder,
                    password: None,
                },
            },
            || false,
            |completed, _, _| {
                if completed == 2 {
                    fs::set_permissions(&file_to_mutate, fs::Permissions::from_mode(0o600))
                        .unwrap();
                }
            },
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
}
