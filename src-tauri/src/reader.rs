use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use libpna::{Archive, Compression, DataKind, Encryption, ReadEntry, ReadOptions};
use serde::{Deserialize, Serialize};
use tauri::State;

const DEFAULT_PAGE_SIZE: usize = 200;
const MAX_PAGE_SIZE: usize = 1_000;
const MAX_PREVIEW_BYTES: usize = 1_048_576;
const MAX_RECENT_ITEMS: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppErrorDto {
    code: &'static str,
    message: String,
    user_action: Option<String>,
    retryable: bool,
}

impl AppErrorDto {
    fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            user_action: None,
            retryable,
        }
    }

    fn with_action(mut self, action: impl Into<String>) -> Self {
        self.user_action = Some(action.into());
        self
    }

    fn internal() -> Self {
        Self::new(
            "INTERNAL_ERROR",
            "The operation could not be completed.",
            true,
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveRecent {
    path: String,
    display_name: String,
    entry_count: usize,
    stored_bytes: u64,
    last_opened_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BootstrapSnapshot {
    product_name: &'static str,
    recent: Vec<ArchiveRecent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveSummary {
    handle: String,
    path: String,
    display_name: String,
    entry_count: usize,
    original_bytes: u64,
    stored_bytes: u64,
    compression_methods: Vec<String>,
    encryption_methods: Vec<String>,
    solid: bool,
    file_modified_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenArchiveResult {
    handle: String,
    summary: ArchiveSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveEntryDto {
    id: String,
    parent_id: Option<String>,
    path: String,
    name: String,
    kind: String,
    original_bytes: Option<u64>,
    stored_bytes: Option<u64>,
    compression: Option<String>,
    encryption: Option<String>,
    modified_at: Option<i64>,
    has_children: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveEntryPage {
    items: Vec<ArchiveEntryDto>,
    next_cursor: Option<String>,
    total_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EntryDetails {
    entry: ArchiveEntryDto,
    created_at: Option<i64>,
    accessed_at: Option<i64>,
    permission: Option<String>,
    owner: Option<String>,
    group: Option<String>,
    xattr_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewDescriptor {
    kind: &'static str,
    text: Option<String>,
    byte_count: u64,
    truncated: bool,
    message_code: Option<&'static str>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SortSpec {
    field: Option<String>,
    direction: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EntryFilter {
    kinds: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
struct IndexedEntry {
    dto: ArchiveEntryDto,
    created_at: Option<i64>,
    accessed_at: Option<i64>,
    permission: Option<String>,
    owner: Option<String>,
    group: Option<String>,
    xattr_count: usize,
}

#[derive(Debug, Clone)]
struct ArchiveSession {
    path: PathBuf,
    password: Option<String>,
    summary: ArchiveSummary,
    entries: Vec<IndexedEntry>,
}

pub(crate) struct ReaderState {
    sessions: Mutex<HashMap<String, ArchiveSession>>,
    recent: Mutex<Vec<ArchiveRecent>>,
    recent_path: PathBuf,
    next_handle: AtomicU64,
}

impl ReaderState {
    pub(crate) fn new(recent_path: PathBuf) -> Self {
        let recent = fs::read(&recent_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            sessions: Mutex::new(HashMap::new()),
            recent: Mutex::new(recent),
            recent_path,
            next_handle: AtomicU64::new(1),
        }
    }

    fn next_handle(&self) -> String {
        format!(
            "archive-{}",
            self.next_handle.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn session(&self, handle: &str) -> Result<ArchiveSession, AppErrorDto> {
        self.sessions
            .lock()
            .map_err(|_| AppErrorDto::internal())?
            .get(handle)
            .cloned()
            .ok_or_else(|| {
                AppErrorDto::new(
                    "INVALID_ARGUMENT",
                    "The archive session was not found. Open the archive again.",
                    true,
                )
            })
    }

    fn remember(&self, summary: &ArchiveSummary) -> Result<(), AppErrorDto> {
        let mut recent = self.recent.lock().map_err(|_| AppErrorDto::internal())?;
        recent.retain(|item| item.path != summary.path);
        recent.insert(
            0,
            ArchiveRecent {
                path: summary.path.clone(),
                display_name: summary.display_name.clone(),
                entry_count: summary.entry_count,
                stored_bytes: summary.stored_bytes,
                last_opened_at: unix_now(),
            },
        );
        recent.truncate(MAX_RECENT_ITEMS);
        persist_recent(&self.recent_path, &recent)
    }
}

#[tauri::command]
pub(crate) fn app_bootstrap(
    state: State<'_, ReaderState>,
) -> Result<BootstrapSnapshot, AppErrorDto> {
    let recent = state
        .recent
        .lock()
        .map_err(|_| AppErrorDto::internal())?
        .clone();
    Ok(BootstrapSnapshot {
        product_name: "Portable Network Archive",
        recent,
    })
}

#[tauri::command]
pub(crate) fn recent_remove(
    state: State<'_, ReaderState>,
    path: String,
) -> Result<Vec<ArchiveRecent>, AppErrorDto> {
    let mut recent = state.recent.lock().map_err(|_| AppErrorDto::internal())?;
    recent.retain(|item| item.path != path);
    persist_recent(&state.recent_path, &recent)?;
    Ok(recent.clone())
}

#[tauri::command]
pub(crate) async fn archive_open(
    state: State<'_, ReaderState>,
    path: PathBuf,
    password: Option<String>,
) -> Result<OpenArchiveResult, AppErrorDto> {
    let handle = state.next_handle();
    let index_handle = handle.clone();
    let path_for_index = path.clone();
    let password_for_index = password.clone();
    let (summary, entries) = tauri::async_runtime::spawn_blocking(move || {
        build_index(
            &index_handle,
            &path_for_index,
            password_for_index.as_deref(),
        )
    })
    .await
    .map_err(|_| AppErrorDto::internal())??;

    let session = ArchiveSession {
        path,
        password,
        summary: summary.clone(),
        entries,
    };
    state
        .sessions
        .lock()
        .map_err(|_| AppErrorDto::internal())?
        .insert(handle.clone(), session);
    state.remember(&summary)?;
    Ok(OpenArchiveResult { handle, summary })
}

#[tauri::command]
pub(crate) fn archive_close(
    state: State<'_, ReaderState>,
    handle: String,
) -> Result<(), AppErrorDto> {
    state
        .sessions
        .lock()
        .map_err(|_| AppErrorDto::internal())?
        .remove(&handle);
    Ok(())
}

#[tauri::command]
pub(crate) fn archive_summary(
    state: State<'_, ReaderState>,
    handle: String,
) -> Result<ArchiveSummary, AppErrorDto> {
    Ok(state.session(&handle)?.summary)
}

#[tauri::command]
pub(crate) fn archive_children(
    state: State<'_, ReaderState>,
    handle: String,
    parent_entry_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
    sort: Option<SortSpec>,
    filter: Option<EntryFilter>,
) -> Result<ArchiveEntryPage, AppErrorDto> {
    let session = state.session(&handle)?;
    let items = session
        .entries
        .iter()
        .filter(|entry| entry.dto.parent_id == parent_entry_id)
        .filter(|entry| matches_filter(entry, filter.as_ref()))
        .cloned()
        .collect();
    Ok(page(items, cursor, limit, sort))
}

#[tauri::command]
pub(crate) fn archive_search(
    state: State<'_, ReaderState>,
    handle: String,
    query: String,
    cursor: Option<String>,
    limit: Option<usize>,
) -> Result<ArchiveEntryPage, AppErrorDto> {
    let session = state.session(&handle)?;
    let query = query.trim().to_lowercase();
    let items = session
        .entries
        .iter()
        .filter(|entry| !query.is_empty() && entry.dto.path.to_lowercase().contains(&query))
        .cloned()
        .collect();
    Ok(page(items, cursor, limit, None))
}

#[tauri::command]
pub(crate) fn archive_entry_details(
    state: State<'_, ReaderState>,
    handle: String,
    entry_id: String,
) -> Result<EntryDetails, AppErrorDto> {
    let session = state.session(&handle)?;
    let entry = find_entry(&session, &entry_id)?;
    Ok(EntryDetails {
        entry: entry.dto.clone(),
        created_at: entry.created_at,
        accessed_at: entry.accessed_at,
        permission: entry.permission.clone(),
        owner: entry.owner.clone(),
        group: entry.group.clone(),
        xattr_count: entry.xattr_count,
    })
}

#[tauri::command]
pub(crate) async fn archive_preview(
    state: State<'_, ReaderState>,
    handle: String,
    entry_id: String,
    max_bytes: Option<usize>,
) -> Result<PreviewDescriptor, AppErrorDto> {
    let session = state.session(&handle)?;
    let entry = find_entry(&session, &entry_id)?.clone();
    let limit = max_bytes.unwrap_or(256 * 1024).clamp(1, MAX_PREVIEW_BYTES);
    tauri::async_runtime::spawn_blocking(move || preview_entry(&session, &entry, limit))
        .await
        .map_err(|_| AppErrorDto::internal())?
}

fn build_index(
    handle: &str,
    path: &Path,
    password: Option<&str>,
) -> Result<(ArchiveSummary, Vec<IndexedEntry>), AppErrorDto> {
    let metadata = fs::metadata(path).map_err(map_open_error)?;
    if !metadata.is_file() {
        return Err(AppErrorDto::new(
            "INVALID_ARGUMENT",
            "The selected item is not a file.",
            false,
        ));
    }

    let (encrypted, solid, outer_compression, outer_encryption) = scan_archive(path)?;
    if encrypted && password.is_none() {
        return Err(AppErrorDto::new(
            "PASSWORD_REQUIRED",
            "A password is required to open this archive.",
            true,
        )
        .with_action("Enter the archive password and try again."));
    }

    let file = fs::File::open(path).map_err(map_open_error)?;
    let mut archive =
        Archive::read_header(file).map_err(|error| map_archive_error(error, false))?;
    let mut raw_entries = BTreeMap::<String, IndexedEntry>::new();
    let mut actual_entry_count = 0usize;
    let mut original_bytes = 0u64;
    let mut compression_methods = outer_compression;
    let mut encryption_methods = outer_encryption;

    for entry in archive.entries_with_password(password.map(str::as_bytes)) {
        let entry =
            entry.map_err(|error| map_archive_error(error, encrypted && password.is_some()))?;
        actual_entry_count += 1;
        let path = entry.header().path().as_str().to_string();
        if path.is_empty() {
            continue;
        }
        let kind = kind_name(entry.header().data_kind()).to_string();
        let compression = compression_name(entry.header().compression()).to_string();
        let encryption = encryption_name(entry.header().encryption()).to_string();
        push_unique(&mut compression_methods, &compression);
        if encryption != "None" {
            push_unique(&mut encryption_methods, &encryption);
            validate_entry_password(&entry, password)?;
        }
        let meta = entry.metadata();
        let raw_size = meta.raw_file_size().and_then(u128_to_u64);
        original_bytes = original_bytes.saturating_add(raw_size.unwrap_or(0));
        let permission = meta.permission();
        let indexed = IndexedEntry {
            dto: ArchiveEntryDto {
                id: String::new(),
                parent_id: None,
                name: entry_name(&path),
                path: path.clone(),
                kind,
                original_bytes: raw_size,
                stored_bytes: Some(meta.compressed_size() as u64),
                compression: Some(compression),
                encryption: Some(encryption),
                modified_at: meta.modified().map(|value| value.whole_seconds()),
                has_children: false,
            },
            created_at: meta.created().map(|value| value.whole_seconds()),
            accessed_at: meta.accessed().map(|value| value.whole_seconds()),
            permission: permission.map(|value| format!("{:04o}", value.permissions())),
            owner: permission.map(|value| {
                if value.uname().is_empty() {
                    value.uid().to_string()
                } else {
                    format!("{} ({})", value.uname(), value.uid())
                }
            }),
            group: permission.map(|value| {
                if value.gname().is_empty() {
                    value.gid().to_string()
                } else {
                    format!("{} ({})", value.gname(), value.gid())
                }
            }),
            xattr_count: entry.xattrs().len(),
        };
        insert_parent_directories(&mut raw_entries, &path);
        raw_entries.insert(path, indexed);
    }

    let entries = finalize_hierarchy(raw_entries);
    let display_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("archive.pna")
        .to_string();
    let summary = ArchiveSummary {
        handle: handle.to_string(),
        path: path.to_string_lossy().into_owned(),
        display_name,
        entry_count: actual_entry_count,
        original_bytes,
        stored_bytes: metadata.len(),
        compression_methods,
        encryption_methods,
        solid,
        file_modified_at: metadata.modified().ok().and_then(system_time_to_unix),
    };
    Ok((summary, entries))
}

fn scan_archive(path: &Path) -> Result<(bool, bool, Vec<String>, Vec<String>), AppErrorDto> {
    let file = fs::File::open(path).map_err(map_open_error)?;
    let mut archive =
        Archive::read_header(file).map_err(|error| map_archive_error(error, false))?;
    let mut encrypted = false;
    let mut solid = false;
    let mut compression = Vec::new();
    let mut encryption = Vec::new();
    for entry in archive.entries() {
        match entry.map_err(|error| map_archive_error(error, false))? {
            ReadEntry::Normal(entry) => {
                let compression_name = compression_name(entry.compression()).to_string();
                let encryption_name = encryption_name(entry.encryption()).to_string();
                push_unique(&mut compression, &compression_name);
                if entry.encryption() != Encryption::No {
                    encrypted = true;
                    push_unique(&mut encryption, &encryption_name);
                }
            }
            ReadEntry::Solid(entry) => {
                solid = true;
                let compression_name = compression_name(entry.compression()).to_string();
                let encryption_name = encryption_name(entry.encryption()).to_string();
                push_unique(&mut compression, &compression_name);
                if entry.encryption() != Encryption::No {
                    encrypted = true;
                    push_unique(&mut encryption, &encryption_name);
                }
            }
        }
    }
    if encryption.is_empty() {
        encryption.push("None".to_string());
    }
    Ok((encrypted, solid, compression, encryption))
}

fn validate_entry_password(
    entry: &libpna::NormalEntry,
    password: Option<&str>,
) -> Result<(), AppErrorDto> {
    let mut reader = entry
        .reader(ReadOptions::with_password(password))
        .map_err(|error| map_archive_error(error, true))?;
    let mut byte = [0u8; 1];
    reader
        .read(&mut byte)
        .map_err(|error| map_archive_error(error, true))?;
    Ok(())
}

fn preview_entry(
    session: &ArchiveSession,
    indexed: &IndexedEntry,
    limit: usize,
) -> Result<PreviewDescriptor, AppErrorDto> {
    let byte_count = indexed.dto.original_bytes.unwrap_or(0);
    if indexed.dto.kind != "file" {
        return Ok(PreviewDescriptor {
            kind: "unsupported",
            text: None,
            byte_count,
            truncated: false,
            message_code: Some("SELECT_FILE"),
        });
    }
    if !is_text_preview(&indexed.dto.name) {
        return Ok(PreviewDescriptor {
            kind: "unsupported",
            text: None,
            byte_count,
            truncated: false,
            message_code: Some("UNSUPPORTED_TYPE"),
        });
    }

    let file = fs::File::open(&session.path).map_err(map_open_error)?;
    let mut archive =
        Archive::read_header(file).map_err(|error| map_archive_error(error, false))?;
    for entry in archive.entries_with_password(session.password.as_deref().map(str::as_bytes)) {
        let entry = entry.map_err(|error| map_archive_error(error, session.password.is_some()))?;
        if entry.header().path().as_str() != indexed.dto.path {
            continue;
        }
        let reader = entry
            .reader(ReadOptions::with_password(session.password.as_deref()))
            .map_err(|error| map_archive_error(error, session.password.is_some()))?;
        let mut bytes = Vec::with_capacity(limit.min(byte_count as usize));
        reader
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| map_archive_error(error, session.password.is_some()))?;
        let truncated = bytes.len() > limit;
        bytes.truncate(limit);
        if bytes.contains(&0) {
            return Ok(PreviewDescriptor {
                kind: "unsupported",
                text: None,
                byte_count,
                truncated,
                message_code: Some("BINARY_DATA"),
            });
        }
        return Ok(PreviewDescriptor {
            kind: "text",
            text: Some(String::from_utf8_lossy(&bytes).into_owned()),
            byte_count,
            truncated,
            message_code: truncated.then_some("TRUNCATED"),
        });
    }
    Err(AppErrorDto::new(
        "PATH_NOT_FOUND",
        "The selected item was not found in the archive.",
        true,
    ))
}

fn insert_parent_directories(entries: &mut BTreeMap<String, IndexedEntry>, path: &str) {
    let mut current = parent_path(path);
    while let Some(parent) = current {
        entries
            .entry(parent.to_string())
            .or_insert_with(|| IndexedEntry {
                dto: ArchiveEntryDto {
                    id: String::new(),
                    parent_id: None,
                    path: parent.to_string(),
                    name: entry_name(parent),
                    kind: "directory".to_string(),
                    original_bytes: None,
                    stored_bytes: None,
                    compression: None,
                    encryption: None,
                    modified_at: None,
                    has_children: true,
                },
                created_at: None,
                accessed_at: None,
                permission: None,
                owner: None,
                group: None,
                xattr_count: 0,
            });
        current = parent_path(parent);
    }
}

fn finalize_hierarchy(entries: BTreeMap<String, IndexedEntry>) -> Vec<IndexedEntry> {
    let ids = entries
        .keys()
        .enumerate()
        .map(|(index, path)| (path.clone(), format!("entry-{index}")))
        .collect::<HashMap<_, _>>();
    let parents = entries
        .keys()
        .filter_map(|path| parent_path(path).map(str::to_string))
        .collect::<HashSet<_>>();
    entries
        .into_iter()
        .map(|(path, mut entry)| {
            entry.dto.id = ids[&path].clone();
            entry.dto.parent_id = parent_path(&path).and_then(|parent| ids.get(parent).cloned());
            entry.dto.has_children = parents.contains(&path);
            entry
        })
        .collect()
}

fn page(
    mut items: Vec<IndexedEntry>,
    cursor: Option<String>,
    limit: Option<usize>,
    sort: Option<SortSpec>,
) -> ArchiveEntryPage {
    sort_entries(&mut items, sort.as_ref());
    let total_count = items.len();
    let start = cursor
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
        .min(total_count);
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    let end = start.saturating_add(limit).min(total_count);
    ArchiveEntryPage {
        items: items[start..end]
            .iter()
            .map(|entry| entry.dto.clone())
            .collect(),
        next_cursor: (end < total_count).then(|| end.to_string()),
        total_count,
    }
}

fn sort_entries(items: &mut [IndexedEntry], sort: Option<&SortSpec>) {
    let field = sort
        .and_then(|value| value.field.as_deref())
        .unwrap_or("name");
    let descending = sort
        .and_then(|value| value.direction.as_deref())
        .is_some_and(|value| value.eq_ignore_ascii_case("desc"));
    items.sort_by(|left, right| {
        let directories = (left.dto.kind != "directory").cmp(&(right.dto.kind != "directory"));
        let mut compared = match field {
            "originalBytes" => left.dto.original_bytes.cmp(&right.dto.original_bytes),
            "storedBytes" => left.dto.stored_bytes.cmp(&right.dto.stored_bytes),
            "modifiedAt" => left.dto.modified_at.cmp(&right.dto.modified_at),
            "kind" => left.dto.kind.cmp(&right.dto.kind),
            _ => left
                .dto
                .name
                .to_lowercase()
                .cmp(&right.dto.name.to_lowercase()),
        };
        if descending {
            compared = compared.reverse();
        }
        directories.then(compared)
    });
}

fn matches_filter(entry: &IndexedEntry, filter: Option<&EntryFilter>) -> bool {
    filter
        .and_then(|value| value.kinds.as_ref())
        .is_none_or(|kinds| kinds.is_empty() || kinds.contains(&entry.dto.kind))
}

fn find_entry<'a>(
    session: &'a ArchiveSession,
    entry_id: &str,
) -> Result<&'a IndexedEntry, AppErrorDto> {
    session
        .entries
        .iter()
        .find(|entry| entry.dto.id == entry_id)
        .ok_or_else(|| AppErrorDto::new("PATH_NOT_FOUND", "The selected item was not found.", true))
}

fn persist_recent(path: &Path, recent: &[ArchiveRecent]) -> Result<(), AppErrorDto> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| AppErrorDto::internal())?;
    }
    let bytes = serde_json::to_vec_pretty(recent).map_err(|_| AppErrorDto::internal())?;
    fs::write(path, bytes).map_err(|_| AppErrorDto::internal())
}

fn map_open_error(error: io::Error) -> AppErrorDto {
    match error.kind() {
        io::ErrorKind::NotFound => AppErrorDto::new(
            "PATH_NOT_FOUND",
            "The archive location was not found.",
            true,
        )
        .with_action("Check the location or choose the archive again."),
        io::ErrorKind::PermissionDenied => AppErrorDto::new(
            "PERMISSION_DENIED",
            "You do not have permission to read this archive.",
            true,
        ),
        _ => AppErrorDto::new("IO_ERROR", "The archive could not be read.", true),
    }
}

fn map_archive_error(_error: io::Error, password_supplied: bool) -> AppErrorDto {
    if password_supplied {
        AppErrorDto::new(
            "WRONG_PASSWORD",
            "The password is incorrect or the encrypted data could not be read.",
            true,
        )
        .with_action("Check the password and try again.")
    } else {
        AppErrorDto::new(
            "ARCHIVE_CORRUPT",
            "This is not a readable PNA archive, or its data is damaged.",
            false,
        )
    }
}

fn compression_name(value: Compression) -> &'static str {
    match value {
        Compression::No => "Store",
        Compression::Deflate => "Deflate",
        Compression::ZStandard => "Zstandard",
        Compression::XZ => "XZ",
    }
}

fn encryption_name(value: Encryption) -> &'static str {
    match value {
        Encryption::No => "None",
        Encryption::Aes => "AES",
        Encryption::Camellia => "Camellia",
    }
}

fn kind_name(value: DataKind) -> &'static str {
    match value {
        DataKind::File => "file",
        DataKind::Directory => "directory",
        DataKind::SymbolicLink => "symlink",
        DataKind::HardLink => "hardlink",
    }
}

fn entry_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn parent_path(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(parent, _)| parent)
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|candidate| candidate == value) {
        values.push(value.to_string());
    }
}

fn u128_to_u64(value: u128) -> Option<u64> {
    u64::try_from(value).ok()
}

fn unix_now() -> i64 {
    system_time_to_unix(SystemTime::now()).unwrap_or_default()
}

fn system_time_to_unix(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
}

fn is_text_preview(name: &str) -> bool {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        extension.as_str(),
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "xml"
            | "csv"
            | "log"
            | "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "css"
            | "html"
            | "htm"
            | "svg"
            | "sh"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::Command;

    use libpna::{EntryBuilder, EntryName, WriteOptions};

    #[test]
    fn hierarchy_adds_implicit_directories() {
        let mut entries = BTreeMap::new();
        insert_parent_directories(&mut entries, "docs/specs/readme.md");
        assert!(entries.contains_key("docs"));
        assert!(entries.contains_key("docs/specs"));
        let entries = finalize_hierarchy(entries);
        let docs = entries
            .iter()
            .find(|entry| entry.dto.path == "docs")
            .unwrap();
        let specs = entries
            .iter()
            .find(|entry| entry.dto.path == "docs/specs")
            .unwrap();
        assert!(docs.dto.parent_id.is_none());
        assert_eq!(specs.dto.parent_id.as_deref(), Some(docs.dto.id.as_str()));
    }

    #[test]
    fn page_caps_requested_limit() {
        let item = |index: usize| IndexedEntry {
            dto: ArchiveEntryDto {
                id: format!("entry-{index}"),
                parent_id: None,
                path: format!("{index}.txt"),
                name: format!("{index}.txt"),
                kind: "file".into(),
                original_bytes: Some(1),
                stored_bytes: Some(1),
                compression: None,
                encryption: None,
                modified_at: None,
                has_children: false,
            },
            created_at: None,
            accessed_at: None,
            permission: None,
            owner: None,
            group: None,
            xattr_count: 0,
        };
        let page = page((0..1_100).map(item).collect(), None, Some(5_000), None);
        assert_eq!(page.items.len(), MAX_PAGE_SIZE);
        assert_eq!(page.next_cursor.as_deref(), Some("1000"));
    }

    #[test]
    fn reads_normal_archive_and_text_preview() {
        let path = test_archive_path("normal");
        write_test_archive(&path, false, false);
        let (summary, entries) = build_index("test-normal", &path, None).unwrap();
        assert_eq!(summary.entry_count, 1);
        assert!(!summary.solid);
        let file = entries
            .iter()
            .find(|entry| entry.dto.path == "docs/readme.txt")
            .unwrap()
            .clone();
        let session = ArchiveSession {
            path: path.clone(),
            password: None,
            summary,
            entries,
        };
        let preview = preview_entry(&session, &file, 128).unwrap();
        assert_eq!(preview.kind, "text");
        assert_eq!(preview.text.as_deref(), Some("hello from pna"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn solid_encrypted_archive_requires_correct_password() {
        let path = test_archive_path("solid-encrypted");
        write_test_archive(&path, true, true);
        assert_eq!(
            build_index("missing-password", &path, None)
                .unwrap_err()
                .code,
            "PASSWORD_REQUIRED"
        );
        assert_eq!(
            build_index("wrong-password", &path, Some("wrong"))
                .unwrap_err()
                .code,
            "WRONG_PASSWORD"
        );
        let (summary, entries) = build_index("correct-password", &path, Some("secret")).unwrap();
        assert!(summary.solid);
        assert_eq!(summary.entry_count, 1);
        assert!(entries
            .iter()
            .any(|entry| entry.dto.path == "docs/readme.txt"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reads_archives_created_by_installed_cli() {
        if Command::new("pna").arg("--version").output().is_err() {
            return;
        }
        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root");
        let normal = test_archive_path("cli-normal");
        let encrypted = test_archive_path("cli-solid-encrypted");

        let normal_status = Command::new("pna")
            .args(["create", "--overwrite", "--zstd", "--file"])
            .arg(&normal)
            .arg("-C")
            .arg(repository)
            .arg("README.md")
            .status()
            .expect("run pna create");
        assert!(normal_status.success());

        let encrypted_status = Command::new("pna")
            .args([
                "create",
                "--overwrite",
                "--solid",
                "--zstd",
                "--aes",
                "cbc",
                "--password",
                "secret",
                "--file",
            ])
            .arg(&encrypted)
            .arg("-C")
            .arg(repository)
            .arg("README.md")
            .status()
            .expect("run encrypted pna create");
        assert!(encrypted_status.success());

        let (normal_summary, _) = build_index("cli-normal", &normal, None).unwrap();
        let (encrypted_summary, _) =
            build_index("cli-solid-encrypted", &encrypted, Some("secret")).unwrap();
        assert_eq!(normal_summary.entry_count, 1);
        assert_eq!(encrypted_summary.entry_count, 1);
        assert!(encrypted_summary.solid);

        fs::remove_file(normal).unwrap();
        fs::remove_file(encrypted).unwrap();
    }

    fn test_archive_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "pna-gui-reader-{label}-{}-{}.pna",
            std::process::id(),
            unix_now()
        ))
    }

    fn write_test_archive(path: &Path, solid: bool, encrypted: bool) {
        let file = fs::File::create(path).unwrap();
        let mut options = WriteOptions::builder();
        options.compression(Compression::ZStandard);
        if encrypted {
            options.encryption(Encryption::Aes).password(Some("secret"));
        }
        if solid {
            let mut archive = Archive::write_solid_header(file, options.build()).unwrap();
            let mut entry =
                EntryBuilder::new_file(EntryName::from("docs/readme.txt"), WriteOptions::store())
                    .unwrap();
            entry.write_all(b"hello from pna").unwrap();
            archive.add_entry(entry.build().unwrap()).unwrap();
            archive.finalize().unwrap();
        } else {
            let mut archive = Archive::write_header(file).unwrap();
            let mut entry =
                EntryBuilder::new_file(EntryName::from("docs/readme.txt"), options.build())
                    .unwrap();
            entry.write_all(b"hello from pna").unwrap();
            archive.add_entry(entry.build().unwrap()).unwrap();
            archive.finalize().unwrap();
        }
    }
}
