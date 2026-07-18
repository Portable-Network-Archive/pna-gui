use std::{
    fs, io,
    io::Read,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use libpna::{Archive, Chunk, ChunkType, DataKind, Encryption, ReadEntry, ReadOptions, PNA_HEADER};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationMode {
    Quick,
    Complete,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    pub archive_path: PathBuf,
    pub password: Option<String>,
    pub mode: VerificationMode,
}

/// `Passed` vouches only for what the mode promises: container structure in
/// quick mode, structure plus all applicable content in complete mode.
/// Applicable content that could not be checked yields `Incomplete`, never
/// `Passed`.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationConclusion {
    Passed,
    IssuesFound,
    Incomplete,
}

/// Mirrored as a string union in `src/features/jobs/api.ts`; keep both in sync.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationCheckCode {
    ArchiveHeader,
    ChunkIntegrity,
    EntryStructure,
    FileContents,
    DirectoryEntry,
    SolidContents,
    LinkEntry,
    UnsupportedEntry,
    EntryPath,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationCheckStatus {
    Passed,
    Failed,
    NotChecked,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCheck {
    pub code: VerificationCheckCode,
    pub status: VerificationCheckStatus,
    pub entry_path: Option<String>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReport {
    pub archive_path: PathBuf,
    pub source_size: u64,
    pub source_modified_at: Option<i64>,
    pub source_sha256: String,
    pub completed_at: i64,
    pub mode: VerificationMode,
    pub conclusion: VerificationConclusion,
    /// `None` when the run ended before the entry pass could determine it.
    pub encrypted: Option<bool>,
    pub solid: Option<bool>,
    /// Entries enumerated in this run: top-level entries (a solid group
    /// counts as one) in quick mode, expanded entries in complete mode.
    pub entries_checked: u64,
    pub files_checked: u64,
    pub bytes_checked: u64,
    pub failed_checks: u64,
    pub not_checked_checks: u64,
    pub checks: Vec<VerificationCheck>,
    #[serde(default)]
    pub checks_omitted: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationSourceStamp {
    pub archive_path: PathBuf,
    pub source_size: u64,
    pub source_modified_at: Option<i64>,
    #[serde(default)]
    pub source_sha256: Option<String>,
}

/// Facts about what a verification run examined. The report's conclusion and
/// counters are derived from these plus the check list, never written by hand.
#[derive(Default)]
struct ReportStats {
    /// `None` when the run ended before the entry pass could determine it.
    encrypted: Option<bool>,
    solid: Option<bool>,
    entries_checked: u64,
    files_checked: u64,
    bytes_checked: u64,
    /// Applicable content existed but could not be checked. Drives
    /// `Incomplete`; quick mode never sets it because that mode does not
    /// promise content checks.
    content_not_checked: bool,
}

struct SourceIdentity {
    size: u64,
    modified_at: Option<i64>,
    sha256: String,
}

impl VerificationReport {
    /// Derives `conclusion`, the status counters, and the bounded check list
    /// from the evidence so they cannot disagree with it.
    fn from_checks(
        request: &VerifyRequest,
        source: &SourceIdentity,
        stats: ReportStats,
        checks: Vec<VerificationCheck>,
    ) -> Self {
        let failed_checks = checks
            .iter()
            .filter(|check| check.status == VerificationCheckStatus::Failed)
            .count() as u64;
        let not_checked_checks = checks
            .iter()
            .filter(|check| check.status == VerificationCheckStatus::NotChecked)
            .count() as u64;
        let conclusion = if failed_checks > 0 {
            VerificationConclusion::IssuesFound
        } else if stats.content_not_checked {
            VerificationConclusion::Incomplete
        } else {
            VerificationConclusion::Passed
        };
        let (checks, checks_omitted) = bound_checks(checks);
        VerificationReport {
            archive_path: request.archive_path.clone(),
            source_size: source.size,
            source_modified_at: source.modified_at,
            source_sha256: source.sha256.clone(),
            completed_at: now_seconds(),
            mode: request.mode,
            conclusion,
            encrypted: stats.encrypted,
            solid: stats.solid,
            entries_checked: stats.entries_checked,
            files_checked: stats.files_checked,
            bytes_checked: stats.bytes_checked,
            failed_checks,
            not_checked_checks,
            checks,
            checks_omitted,
        }
    }
}

/// Best-effort staleness heuristic (size plus mtime in whole seconds), not a
/// content check: a same-size replacement within the same second passes.
/// Returns `None` when a modification time is unavailable on either side, so
/// a size-only comparison is never presented as confirmed freshness.
#[tauri::command]
pub fn verification_source_matches(
    request: VerificationSourceStamp,
) -> Result<Option<bool>, String> {
    let metadata = match fs::metadata(&request.archive_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Some(false)),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.len() != request.source_size {
        return Ok(Some(false));
    }
    if let Some(recorded_hash) = request.source_sha256 {
        // The hash is the strongest signal available and must be
        // authoritative: an mtime difference does not prove content changed
        // (e.g. a restore or checkout can touch mtime without changing
        // bytes), so it must never be used to skip this comparison.
        return sha256_file(&request.archive_path)
            .map(|current_hash| Some(current_hash == recorded_hash))
            .map_err(|error| error.to_string());
    }
    Ok(
        match (modified_seconds(&metadata), request.source_modified_at) {
            (Some(current), Some(recorded)) => Some(current == recorded),
            _ => None,
        },
    )
}

/// Verifies the archive without changing it and returns a factual report.
///
/// `progress` units switch with the phase: the chunk scan reports
/// (bytes read, total bytes), the complete-mode content pass reports
/// (entries done, entry count).
pub fn verify_archive<C, P>(
    request: &VerifyRequest,
    cancelled: C,
    mut progress: P,
) -> io::Result<VerificationReport>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    let metadata = fs::metadata(&request.archive_path)?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the verification source is not a file",
        ));
    }
    check_cancelled(&cancelled)?;
    let source = SourceIdentity {
        size: metadata.len(),
        modified_at: modified_seconds(&metadata),
        sha256: sha256_file_with_cancel(&request.archive_path, &cancelled)?,
    };
    // Framing around each chunk body: 4-byte length, 4-byte type, 4-byte CRC.
    const CHUNK_FRAMING_BYTES: u64 = 12;
    let mut completed_bytes = PNA_HEADER.len() as u64;
    let total_bytes = metadata.len();
    let chunks = match libpna::read_as_chunks(fs::File::open(&request.archive_path)?) {
        Ok(chunks) => chunks,
        Err(error) => {
            return Ok(VerificationReport::from_checks(
                request,
                &source,
                ReportStats::default(),
                vec![
                    failed_check(
                        VerificationCheckCode::ArchiveHeader,
                        None,
                        error.to_string(),
                    ),
                    not_checked(
                        VerificationCheckCode::ChunkIntegrity,
                        "The archive header could not be read.",
                    ),
                    not_checked(
                        VerificationCheckCode::EntryStructure,
                        "The archive header could not be read.",
                    ),
                    not_checked(
                        VerificationCheckCode::FileContents,
                        "The archive header could not be read.",
                    ),
                ],
            ));
        }
    };
    for chunk in chunks {
        check_cancelled(&cancelled)?;
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                return Ok(VerificationReport::from_checks(
                    request,
                    &source,
                    ReportStats::default(),
                    vec![
                        passed_check(VerificationCheckCode::ArchiveHeader),
                        failed_check(
                            VerificationCheckCode::ChunkIntegrity,
                            None,
                            error.to_string(),
                        ),
                        not_checked(
                            VerificationCheckCode::EntryStructure,
                            "Chunk validation did not complete.",
                        ),
                        not_checked(
                            VerificationCheckCode::FileContents,
                            "Entry structure was not available.",
                        ),
                    ],
                ));
            }
        };
        completed_bytes =
            completed_bytes.saturating_add(chunk.length() as u64 + CHUNK_FRAMING_BYTES);
        progress(
            completed_bytes.min(total_bytes),
            total_bytes,
            &request.archive_path.to_string_lossy(),
        );
    }

    check_cancelled(&cancelled)?;
    let mut archive = Archive::read_header(fs::File::open(&request.archive_path)?)?;
    let mut entries_checked = 0_u64;
    let mut encrypted = false;
    let mut solid = false;
    let mut solid_encrypted = false;
    for entry in archive.entries() {
        check_cancelled(&cancelled)?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                return Ok(VerificationReport::from_checks(
                    request,
                    &source,
                    ReportStats {
                        // Enumeration stopped early: the flags observed so far
                        // can prove presence but never absence.
                        encrypted: encrypted.then_some(true),
                        solid: solid.then_some(true),
                        entries_checked,
                        ..ReportStats::default()
                    },
                    vec![
                        passed_check(VerificationCheckCode::ArchiveHeader),
                        passed_check(VerificationCheckCode::ChunkIntegrity),
                        failed_check(
                            VerificationCheckCode::EntryStructure,
                            None,
                            error.to_string(),
                        ),
                        not_checked(
                            VerificationCheckCode::FileContents,
                            "Entry validation did not complete.",
                        ),
                    ],
                ));
            }
        };
        entries_checked += 1;
        match entry {
            ReadEntry::Normal(entry) => {
                encrypted |= entry.encryption() != Encryption::No;
            }
            ReadEntry::Solid(entry) => {
                let group_encrypted = entry.encryption() != Encryption::No;
                encrypted |= group_encrypted;
                solid_encrypted |= group_encrypted;
                solid = true;
            }
        }
    }

    if request.mode == VerificationMode::Complete {
        return complete_verification(
            request,
            cancelled,
            progress,
            encrypted,
            solid,
            solid_encrypted,
            source,
        );
    }

    if !source_unchanged_since(&request.archive_path, &source)? {
        return Err(io::Error::other(
            "the archive changed while it was being verified",
        ));
    }
    Ok(VerificationReport::from_checks(
        request,
        &source,
        ReportStats {
            encrypted: Some(encrypted),
            solid: Some(solid),
            entries_checked,
            ..ReportStats::default()
        },
        vec![
            passed_check(VerificationCheckCode::ArchiveHeader),
            passed_check(VerificationCheckCode::ChunkIntegrity),
            passed_check(VerificationCheckCode::EntryStructure),
            not_checked(
                VerificationCheckCode::FileContents,
                "Quick verification does not decrypt or decompress file contents.",
            ),
        ],
    ))
}

fn complete_verification<C, P>(
    request: &VerifyRequest,
    cancelled: C,
    mut progress: P,
    encrypted: bool,
    solid: bool,
    solid_encrypted: bool,
    source: SourceIdentity,
) -> io::Result<VerificationReport>
where
    C: Fn() -> bool,
    P: FnMut(u64, u64, &str),
{
    let password = request.password.as_deref();
    // Streaming preflight for the progress denominator, mirroring
    // `preflight_extract`: entries are dropped as they are counted so the
    // archive payload is never held in memory at once.
    let mut archive = Archive::read_header(fs::File::open(&request.archive_path)?)?;
    let mut total = 0_u64;
    for entry in archive.entries_with_password(password.map(str::as_bytes)) {
        check_cancelled(&cancelled)?;
        if entry.is_err() {
            break;
        }
        total += 1;
    }

    let mut archive = Archive::read_header(fs::File::open(&request.archive_path)?)?;
    let mut processed = 0_u64;
    let mut any_file_entry = false;
    let mut expansion_complete = true;
    let mut files_checked = 0_u64;
    let mut bytes_checked = 0_u64;
    let mut content_not_checked = false;
    let mut checks = vec![
        passed_check(VerificationCheckCode::ArchiveHeader),
        passed_check(VerificationCheckCode::ChunkIntegrity),
        passed_check(VerificationCheckCode::EntryStructure),
    ];

    for entry in archive.entries_with_password(password.map(str::as_bytes)) {
        check_cancelled(&cancelled)?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                // A solid group is the only content this pass decodes while
                // enumerating, so without one the failure is a read error,
                // not a decode failure.
                checks.push(if solid {
                    failed_check(
                        VerificationCheckCode::SolidContents,
                        None,
                        decode_failure_detail(
                            format!("A solid group could not be decrypted or decoded: {error}."),
                            solid_encrypted,
                        ),
                    )
                } else {
                    failed_check(
                        VerificationCheckCode::FileContents,
                        None,
                        format!("Entries could not be enumerated for content reading: {error}."),
                    )
                });
                // Stop at the first expansion failure: depending on the
                // failure, the iterator either repeats the same error or has
                // already skipped the group's contents, so the remainder is
                // reported as not enumerated instead of guessed at.
                expansion_complete = false;
                break;
            }
        };
        processed += 1;
        any_file_entry |= entry.header().data_kind() == DataKind::File;
        let path = entry.header().path().as_str().to_string();
        if let Err(error) = crate::safe_relative_entry_path(entry.header().path().as_path()) {
            checks.push(failed_check(
                VerificationCheckCode::EntryPath,
                Some(path.clone()),
                format!("The entry cannot be restored ({error}); its content was not read."),
            ));
            progress(processed, total, &path);
            continue;
        }
        let entry_encrypted = entry.header().encryption() != Encryption::No;
        match entry.header().data_kind() {
            DataKind::File => {
                let expected_digest = entry
                    .extra_chunks()
                    .iter()
                    .find(|chunk| chunk.ty() == plaintext_digest_chunk_type())
                    .map(|chunk| chunk.data());
                // Encrypted store content without a plaintext digest is
                // unverifiable: a wrong password decrypts to silent garbage.
                // Compressed content is exempt because decompressing garbage
                // fails loudly.
                if entry_encrypted
                    && entry.header().compression() == libpna::Compression::No
                    && expected_digest.is_none()
                {
                    record_content_not_checked(
                        &mut checks,
                        &mut content_not_checked,
                        VerificationCheckCode::FileContents,
                        Some(path.clone()),
                        "Encrypted uncompressed content has no plaintext integrity metadata.",
                    );
                } else {
                    let read_result = (|| -> io::Result<(u64, Sha256)> {
                        let mut reader = entry.reader(ReadOptions::with_password(password))?;
                        let mut digest = Sha256::new();
                        let mut entry_bytes = 0_u64;
                        let mut buffer = [0_u8; 64 * 1024];
                        let mut consecutive_interruptions = 0_u32;
                        loop {
                            check_cancelled(&cancelled)?;
                            let read = match reader.read(&mut buffer) {
                                Ok(read) => {
                                    consecutive_interruptions = 0;
                                    read
                                }
                                // Retry EINTR from the operating system, but
                                // bounded so a source that keeps returning it
                                // cannot spin forever; `ErrorKind::Interrupted`
                                // is otherwise reserved for the cancellation
                                // signal from `check_cancelled`, which must
                                // propagate.
                                Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                                    consecutive_interruptions += 1;
                                    if consecutive_interruptions >= MAX_CONSECUTIVE_INTERRUPTIONS {
                                        return Err(io::Error::other(
                                            "reading was interrupted repeatedly without progress",
                                        ));
                                    }
                                    continue;
                                }
                                Err(error) => return Err(error),
                            };
                            if read == 0 {
                                break;
                            }
                            entry_bytes = entry_bytes.saturating_add(read as u64);
                            digest.update(&buffer[..read]);
                        }
                        Ok((entry_bytes, digest))
                    })();
                    match read_result {
                        // Cancellation from `check_cancelled`; never recorded
                        // as corruption evidence.
                        Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                            return Err(error);
                        }
                        Err(error) => checks.push(failed_check(
                            VerificationCheckCode::FileContents,
                            Some(path.clone()),
                            decode_failure_detail(
                                format!("Decoded content could not be read: {error}."),
                                entry_encrypted,
                            ),
                        )),
                        Ok((entry_bytes, digest)) => {
                            if expected_digest
                                .is_some_and(|expected| digest.finalize().as_slice() != expected)
                            {
                                checks.push(failed_check(
                                    VerificationCheckCode::FileContents,
                                    Some(path.clone()),
                                    decode_failure_detail(
                                        "The decoded content did not match its integrity digest."
                                            .into(),
                                        entry_encrypted,
                                    ),
                                ));
                            } else {
                                files_checked += 1;
                                bytes_checked = bytes_checked.saturating_add(entry_bytes);
                                checks.push(passed_entry(
                                    VerificationCheckCode::FileContents,
                                    path.clone(),
                                    Some(format!("Read {entry_bytes} decoded bytes.")),
                                ));
                            }
                        }
                    }
                }
            }
            DataKind::Directory => checks.push(passed_entry(
                VerificationCheckCode::DirectoryEntry,
                path.clone(),
                None,
            )),
            DataKind::SymbolicLink | DataKind::HardLink => record_content_not_checked(
                &mut checks,
                &mut content_not_checked,
                VerificationCheckCode::LinkEntry,
                Some(path.clone()),
                "Archive links are never restored by this application.",
            ),
            DataKind::Reserved(_) | DataKind::Private(_) => record_content_not_checked(
                &mut checks,
                &mut content_not_checked,
                VerificationCheckCode::UnsupportedEntry,
                Some(path.clone()),
                "This entry kind is not restored by this application.",
            ),
        }
        progress(processed, total, &path);
    }

    if !expansion_complete {
        record_content_not_checked(
            &mut checks,
            &mut content_not_checked,
            VerificationCheckCode::FileContents,
            None,
            "Entries after the failed solid group were not enumerated, so their contents were not read.",
        );
    } else if !any_file_entry {
        checks.push(not_checked(
            VerificationCheckCode::FileContents,
            "The archive contains no file entries, so there was no file content to read.",
        ));
    }

    if !source_unchanged_since(&request.archive_path, &source)? {
        return Err(io::Error::other(
            "the archive changed while it was being verified",
        ));
    }
    Ok(VerificationReport::from_checks(
        request,
        &source,
        ReportStats {
            encrypted: Some(encrypted),
            solid: Some(solid),
            entries_checked: processed,
            files_checked,
            bytes_checked,
            content_not_checked,
        },
        checks,
    ))
}

/// Appends the password hint to decode-failure evidence for encrypted
/// content, where damage and a wrong password are indistinguishable.
fn decode_failure_detail(detail: String, encrypted: bool) -> String {
    if encrypted {
        format!("{detail} This also occurs when the password is incorrect.")
    } else {
        detail
    }
}

fn plaintext_digest_chunk_type() -> ChunkType {
    ChunkType::private(crate::operations::PLAINTEXT_DIGEST_CHUNK_BYTES)
        .expect("the PNA GUI digest chunk type is valid")
}

fn passed_check(code: VerificationCheckCode) -> VerificationCheck {
    VerificationCheck {
        code,
        status: VerificationCheckStatus::Passed,
        entry_path: None,
        detail: None,
    }
}

fn not_checked(code: VerificationCheckCode, detail: &str) -> VerificationCheck {
    VerificationCheck {
        code,
        status: VerificationCheckStatus::NotChecked,
        entry_path: None,
        detail: Some(detail.into()),
    }
}

fn failed_check(
    code: VerificationCheckCode,
    entry_path: Option<String>,
    detail: String,
) -> VerificationCheck {
    VerificationCheck {
        code,
        status: VerificationCheckStatus::Failed,
        entry_path,
        detail: Some(detail),
    }
}

fn passed_entry(
    code: VerificationCheckCode,
    entry_path: String,
    detail: Option<String>,
) -> VerificationCheck {
    VerificationCheck {
        code,
        status: VerificationCheckStatus::Passed,
        entry_path: Some(entry_path),
        detail,
    }
}

/// Records content that existed but could not be checked, keeping the
/// `Incomplete`-driving flag and its `NotChecked` evidence together.
fn record_content_not_checked(
    checks: &mut Vec<VerificationCheck>,
    content_not_checked: &mut bool,
    code: VerificationCheckCode,
    entry_path: Option<String>,
    detail: &str,
) {
    *content_not_checked = true;
    checks.push(VerificationCheck {
        code,
        status: VerificationCheckStatus::NotChecked,
        entry_path,
        detail: Some(detail.into()),
    });
}

const MAX_CONSECUTIVE_INTERRUPTIONS: u32 = 4096;

const MAX_REPORTED_CHECKS: usize = 200;

fn bound_checks(mut checks: Vec<VerificationCheck>) -> (Vec<VerificationCheck>, u64) {
    checks.sort_by_key(|check| match check.status {
        VerificationCheckStatus::Failed => 0,
        VerificationCheckStatus::NotChecked => 1,
        VerificationCheckStatus::Passed => 2,
    });
    let omitted = checks.len().saturating_sub(MAX_REPORTED_CHECKS) as u64;
    checks.truncate(MAX_REPORTED_CHECKS);
    (checks, omitted)
}

/// Guards against the archive being replaced or modified between the
/// upfront hash and the later read passes (header, chunks, entries): each
/// pass reopens the file independently, so a mutation partway through would
/// otherwise let the report's SHA-256 describe different bytes than what was
/// actually checked.
fn source_unchanged_since(path: &std::path::Path, source: &SourceIdentity) -> io::Result<bool> {
    let metadata = fs::metadata(path)?;
    Ok(metadata.len() == source.size
        && match (modified_seconds(&metadata), source.modified_at) {
            (Some(current), Some(recorded)) => current == recorded,
            _ => true,
        })
}

fn modified_seconds(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
}

fn sha256_file(path: &std::path::Path) -> io::Result<String> {
    sha256_file_with_cancel(path, &|| false)
}

fn sha256_file_with_cancel(
    path: &std::path::Path,
    cancelled: &impl Fn() -> bool,
) -> io::Result<String> {
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

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

/// Signals cancellation as `ErrorKind::Interrupted`, which the job layer (via
/// the shared cancellation flag) resolves to the cancelled lifecycle;
/// verification must propagate it unchanged and never record it as check
/// evidence.
fn check_cancelled(cancelled: &impl Fn() -> bool) -> io::Result<()> {
    if cancelled() {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "verification cancelled",
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write};

    use libpna::{
        Archive, EntryBuilder, EntryName, EntryReference, SolidEntryBuilder, WriteOptions,
    };
    use tempfile::tempdir;

    use super::*;

    fn write_encrypted_store(path: &std::path::Path, password: &str, with_digest: bool) {
        let content = b"encrypted verification payload";
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let options = WriteOptions::builder()
            .encryption(libpna::Encryption::Aes)
            .password(Some(password))
            .build();
        let mut entry = EntryBuilder::new_file(EntryName::from("secret.txt"), options).unwrap();
        entry.write_all(content).unwrap();
        if with_digest {
            entry.add_extra_chunk(libpna::RawChunk::from_data(
                plaintext_digest_chunk_type(),
                Sha256::digest(content).to_vec(),
            ));
        }
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }

    fn write_encrypted_compressed(path: &std::path::Path, password: &str) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let options = WriteOptions::builder()
            .compression(libpna::Compression::ZStandard)
            .encryption(libpna::Encryption::Aes)
            .password(Some(password))
            .build();
        let mut entry = EntryBuilder::new_file(EntryName::from("secret.txt"), options).unwrap();
        entry.write_all(b"compressed encrypted payload").unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }

    fn write_encrypted_solid(path: &std::path::Path, password: &str) {
        let file = fs::File::create(path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let options = WriteOptions::builder()
            .compression(libpna::Compression::ZStandard)
            .encryption(libpna::Encryption::Aes)
            .password(Some(password))
            .build();
        let mut solid = SolidEntryBuilder::new(options).unwrap();
        let mut entry =
            EntryBuilder::new_file(EntryName::from("solid.txt"), WriteOptions::store()).unwrap();
        entry.write_all(b"solid encrypted payload").unwrap();
        solid.add_entry(entry.build().unwrap()).unwrap();
        archive.add_entry(solid.build().unwrap()).unwrap();
        archive.finalize().unwrap();
    }

    #[test]
    fn verification_rejects_a_report_when_the_archive_changes_mid_run() {
        // BE-VERIFY-SOURCE-MUTATED-MID-RUN
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("mutated.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut entry =
            EntryBuilder::new_file(EntryName::from("readme.txt"), WriteOptions::store()).unwrap();
        entry.write_all(b"verified payload").unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();

        let error = verify_archive(
            &VerifyRequest {
                archive_path: archive_path.clone(),
                password: None,
                mode: VerificationMode::Quick,
            },
            || false,
            |_, _, _| {
                // Simulates an external process replacing the archive after
                // its SHA-256 was recorded but before this pass finishes.
                let mut file = fs::OpenOptions::new()
                    .append(true)
                    .open(&archive_path)
                    .unwrap();
                file.write_all(b"appended after hashing").unwrap();
            },
        )
        .unwrap_err();

        assert!(error
            .to_string()
            .contains("changed while it was being verified"));
    }

    #[test]
    fn quick_verification_reports_exactly_what_was_checked() {
        // BE-VERIFY-QUICK-VALID
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("valid.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut entry =
            EntryBuilder::new_file(EntryName::from("readme.txt"), WriteOptions::store()).unwrap();
        entry.write_all(b"verified payload").unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path: archive_path.clone(),
                password: None,
                mode: VerificationMode::Quick,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::Passed);
        assert_eq!(report.entries_checked, 1);
        assert_eq!(report.files_checked, 0);
        assert_eq!(report.bytes_checked, 0);
        assert_eq!(
            report
                .checks
                .iter()
                .map(|check| (check.code, check.status))
                .collect::<Vec<_>>(),
            vec![
                (
                    VerificationCheckCode::FileContents,
                    VerificationCheckStatus::NotChecked
                ),
                (
                    VerificationCheckCode::ArchiveHeader,
                    VerificationCheckStatus::Passed
                ),
                (
                    VerificationCheckCode::ChunkIntegrity,
                    VerificationCheckStatus::Passed
                ),
                (
                    VerificationCheckCode::EntryStructure,
                    VerificationCheckStatus::Passed
                ),
            ]
        );
    }

    #[test]
    fn complete_verification_reads_every_file_and_reports_item_evidence() {
        // BE-VERIFY-COMPLETE-VALID
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("complete.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut entry = EntryBuilder::new_file(
            EntryName::from("docs/readme.txt"),
            WriteOptions::builder()
                .compression(libpna::Compression::ZStandard)
                .build(),
        )
        .unwrap();
        entry.write_all(b"complete verification payload").unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::Passed);
        assert_eq!(report.files_checked, 1);
        assert_eq!(report.bytes_checked, 29);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::FileContents
                && check.entry_path.as_deref() == Some("docs/readme.txt")
                && check.status == VerificationCheckStatus::Passed
        }));
    }

    #[test]
    fn quick_verification_returns_a_factual_report_for_corrupt_chunk_data() {
        // BE-VERIFY-CORRUPT-CHUNK
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("corrupt.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut entry =
            EntryBuilder::new_file(EntryName::from("data.txt"), WriteOptions::store()).unwrap();
        entry.write_all(b"recognizable payload").unwrap();
        archive.add_entry(entry.build().unwrap()).unwrap();
        archive.finalize().unwrap();
        let mut bytes = fs::read(&archive_path).unwrap();
        let offset = bytes
            .windows(b"recognizable payload".len())
            .position(|window| window == b"recognizable payload")
            .unwrap();
        bytes[offset] ^= 0xff;
        fs::write(&archive_path, bytes).unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Quick,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::ChunkIntegrity
                && check.status == VerificationCheckStatus::Failed
                && check
                    .detail
                    .as_deref()
                    .is_some_and(|detail| !detail.is_empty())
        }));
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::EntryStructure
                && check.status == VerificationCheckStatus::NotChecked
        }));
    }

    #[test]
    fn complete_verification_accepts_the_correct_encrypted_store_password() {
        // BE-VERIFY-ENCRYPTED-CORRECT
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("encrypted.pna");
        write_encrypted_store(&archive_path, "correct-password", true);

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("correct-password".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::Passed);
        assert_eq!(report.encrypted, Some(true));
        assert_eq!(report.files_checked, 1);
        assert_eq!(report.bytes_checked, 30);
    }

    #[test]
    fn complete_verification_rejects_an_encrypted_store_password_by_digest_evidence() {
        // BE-VERIFY-ENCRYPTED-WRONG
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("encrypted.pna");
        write_encrypted_store(&archive_path, "correct-password", true);

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("wrong-password".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert_eq!(report.files_checked, 0);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::FileContents
                && check.entry_path.as_deref() == Some("secret.txt")
                && check.status == VerificationCheckStatus::Failed
                && check
                    .detail
                    .as_deref()
                    .is_some_and(|detail| detail.contains("integrity digest"))
        }));
    }

    #[test]
    fn complete_verification_does_not_invent_a_password_result_for_an_empty_archive() {
        // BE-VERIFY-EMPTY-ARCHIVE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("empty.pna");
        let file = fs::File::create(&archive_path).unwrap();
        Archive::write_header(file).unwrap().finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("irrelevant".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::Passed);
        assert_eq!(report.entries_checked, 0);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::FileContents
                && check.status == VerificationCheckStatus::NotChecked
                && check
                    .detail
                    .as_deref()
                    .is_some_and(|detail| detail.contains("no file entries"))
        }));
    }

    #[test]
    fn complete_verification_records_a_decryption_failure_as_item_evidence() {
        // BE-VERIFY-ENCRYPTED-DECODE-FAILURE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("compressed-encrypted.pna");
        write_encrypted_compressed(&archive_path, "correct-password");

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("wrong-password".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::FileContents
                && check.entry_path.as_deref() == Some("secret.txt")
                && check.status == VerificationCheckStatus::Failed
        }));
    }

    #[test]
    fn complete_verification_reports_an_unportable_entry_path_and_continues() {
        // BE-VERIFY-UNSAFE-ENTRY-PATH
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("unportable.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let mut reserved =
            EntryBuilder::new_file(EntryName::from("aux.txt"), WriteOptions::store()).unwrap();
        reserved.write_all(b"reserved name").unwrap();
        archive.add_entry(reserved.build().unwrap()).unwrap();
        let mut valid =
            EntryBuilder::new_file(EntryName::from("valid.txt"), WriteOptions::store()).unwrap();
        valid.write_all(b"valid").unwrap();
        archive.add_entry(valid.build().unwrap()).unwrap();
        archive.finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert_eq!(report.files_checked, 1);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::EntryPath
                && check.status == VerificationCheckStatus::Failed
                && check.entry_path.as_deref() == Some("aux.txt")
        }));
        assert!(report.checks.iter().any(|check| {
            check.entry_path.as_deref() == Some("valid.txt")
                && check.status == VerificationCheckStatus::Passed
        }));
    }

    #[test]
    fn verification_reports_an_unreadable_container_instead_of_failing_the_job() {
        // BE-VERIFY-CONTAINER-UNREADABLE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("not-an-archive.pna");
        fs::write(&archive_path, b"this is not a pna archive").unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Quick,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::ArchiveHeader
                && check.status == VerificationCheckStatus::Failed
        }));
        assert_eq!(report.not_checked_checks, 3);
        // The entry pass never ran, so the report must not assert these facts.
        assert_eq!(report.encrypted, None);
        assert_eq!(report.solid, None);
    }

    #[test]
    fn complete_verification_names_the_missing_password_for_encrypted_content() {
        // BE-VERIFY-ENCRYPTED-MISSING-PASSWORD
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("encrypted.pna");
        write_encrypted_store(&archive_path, "correct-password", true);

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert_eq!(report.files_checked, 0);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::FileContents
                && check.status == VerificationCheckStatus::Failed
                && check
                    .detail
                    .as_deref()
                    .is_some_and(|detail| detail.contains("password"))
        }));
    }

    #[test]
    fn complete_verification_records_an_encrypted_solid_decode_failure() {
        // BE-VERIFY-ENCRYPTED-SOLID-WRONG
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("solid-encrypted.pna");
        write_encrypted_solid(&archive_path, "correct-password");

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("wrong-password".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert_eq!(report.solid, Some(true));
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::SolidContents
                && check.status == VerificationCheckStatus::Failed
        }));
    }

    #[test]
    fn complete_verification_states_when_entries_after_a_failed_solid_group_are_not_enumerated() {
        // BE-VERIFY-SOLID-REMAINDER-REPORTED
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("solid-then-file.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        let options = WriteOptions::builder()
            .compression(libpna::Compression::ZStandard)
            .encryption(libpna::Encryption::Aes)
            .password(Some("correct-password"))
            .build();
        let mut solid = SolidEntryBuilder::new(options).unwrap();
        let mut inner =
            EntryBuilder::new_file(EntryName::from("solid.txt"), WriteOptions::store()).unwrap();
        inner.write_all(b"solid payload").unwrap();
        solid.add_entry(inner.build().unwrap()).unwrap();
        archive.add_entry(solid.build().unwrap()).unwrap();
        let mut plain =
            EntryBuilder::new_file(EntryName::from("after.txt"), WriteOptions::store()).unwrap();
        plain.write_all(b"after").unwrap();
        archive.add_entry(plain.build().unwrap()).unwrap();
        archive.finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("wrong-password".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::SolidContents
                && check.status == VerificationCheckStatus::Failed
        }));
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::FileContents
                && check.status == VerificationCheckStatus::NotChecked
                && check
                    .detail
                    .as_deref()
                    .is_some_and(|detail| detail.contains("not enumerated"))
        }));
        assert!(!report.checks.iter().any(|check| {
            check
                .detail
                .as_deref()
                .is_some_and(|detail| detail.contains("no file entries"))
        }));
    }

    #[test]
    fn complete_verification_marks_legacy_encrypted_store_content_unverifiable() {
        // BE-VERIFY-ENCRYPTED-LEGACY-UNVERIFIABLE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("legacy-encrypted.pna");
        write_encrypted_store(&archive_path, "correct-password", false);

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("correct-password".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::Incomplete);
        assert_eq!(report.files_checked, 0);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::FileContents
                && check.status == VerificationCheckStatus::NotChecked
                && check.entry_path.as_deref() == Some("secret.txt")
        }));
    }

    #[test]
    fn complete_verification_handles_a_directory_only_archive_without_password_guessing() {
        // BE-VERIFY-DIRECTORY-ONLY
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("directories.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        archive
            .add_entry(
                EntryBuilder::new_dir(EntryName::from("documents"))
                    .build()
                    .unwrap(),
            )
            .unwrap();
        archive.finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("irrelevant".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::Passed);
        assert_eq!(report.entries_checked, 1);
        assert_eq!(report.files_checked, 0);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::DirectoryEntry
                && check.status == VerificationCheckStatus::Passed
        }));
    }

    #[test]
    fn complete_verification_marks_links_as_not_restorable() {
        // BE-VERIFY-LINK-NOT-RESTORABLE
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("link.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        archive
            .add_entry(
                EntryBuilder::new_symlink(
                    EntryName::from("shortcut"),
                    EntryReference::from("target"),
                )
                .unwrap()
                .build()
                .unwrap(),
            )
            .unwrap();
        archive.finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::Incomplete);
        assert!(report.checks.iter().any(|check| {
            check.code == VerificationCheckCode::LinkEntry
                && check.status == VerificationCheckStatus::NotChecked
                && check.entry_path.as_deref() == Some("shortcut")
        }));
    }

    #[test]
    fn complete_verification_accepts_a_correct_encrypted_solid_password() {
        // BE-VERIFY-ENCRYPTED-SOLID-CORRECT
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("solid-encrypted.pna");
        write_encrypted_solid(&archive_path, "correct-password");

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: Some("correct-password".into()),
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::Passed);
        assert_eq!(report.solid, Some(true));
        assert_eq!(report.encrypted, Some(true));
        assert_eq!(report.files_checked, 1);
    }

    #[test]
    fn complete_verification_continues_after_an_item_digest_failure() {
        // BE-VERIFY-PARTIAL-CONTINUATION
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("partial.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        for (name, content, digest) in [
            ("broken.txt", b"broken".as_slice(), vec![0_u8; 32]),
            (
                "valid.txt",
                b"valid".as_slice(),
                Sha256::digest(b"valid").to_vec(),
            ),
        ] {
            let mut entry =
                EntryBuilder::new_file(EntryName::from(name), WriteOptions::store()).unwrap();
            entry.write_all(content).unwrap();
            entry.add_extra_chunk(libpna::RawChunk::from_data(
                plaintext_digest_chunk_type(),
                digest,
            ));
            archive.add_entry(entry.build().unwrap()).unwrap();
        }
        archive.finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert_eq!(report.files_checked, 1);
        assert!(report.checks.iter().any(|check| {
            check.entry_path.as_deref() == Some("broken.txt")
                && check.status == VerificationCheckStatus::Failed
                && check
                    .detail
                    .as_deref()
                    .is_some_and(|detail| !detail.contains("password"))
        }));
        assert!(report.checks.iter().any(|check| {
            check.entry_path.as_deref() == Some("valid.txt")
                && check.status == VerificationCheckStatus::Passed
        }));
    }

    #[test]
    fn complete_verification_bounds_report_evidence_and_prioritizes_issues() {
        // BE-VERIFY-REPORT-BOUNDED
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("many-entries.pna");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = Archive::write_header(file).unwrap();
        for index in 0..220 {
            archive
                .add_entry(
                    EntryBuilder::new_dir(EntryName::from(format!("directory-{index:03}")))
                        .build()
                        .unwrap(),
                )
                .unwrap();
        }
        let mut broken =
            EntryBuilder::new_file(EntryName::from("broken.txt"), WriteOptions::store()).unwrap();
        broken.write_all(b"broken").unwrap();
        broken.add_extra_chunk(libpna::RawChunk::from_data(
            plaintext_digest_chunk_type(),
            vec![0_u8; 32],
        ));
        archive.add_entry(broken.build().unwrap()).unwrap();
        archive.finalize().unwrap();

        let report = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Complete,
            },
            || false,
            |_, _, _| {},
        )
        .unwrap();

        assert_eq!(report.conclusion, VerificationConclusion::IssuesFound);
        assert!(report.checks.len() <= 200);
        assert!(report.checks_omitted > 0);
        assert_eq!(report.checks[0].status, VerificationCheckStatus::Failed);
    }

    #[test]
    fn verification_cancellation_is_reported_as_interruption_not_corruption() {
        // BE-VERIFY-CANCEL
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("cancel.pna");
        let file = fs::File::create(&archive_path).unwrap();
        Archive::write_header(file).unwrap().finalize().unwrap();

        let error = verify_archive(
            &VerifyRequest {
                archive_path,
                password: None,
                mode: VerificationMode::Quick,
            },
            || true,
            |_, _, _| {},
        )
        .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    }

    #[test]
    fn verification_source_stamp_detects_replacement_and_removal() {
        // BE-VERIFY-RESULT-VERSION
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("versioned.pna");
        fs::write(&archive_path, b"version one").unwrap();
        let metadata = fs::metadata(&archive_path).unwrap();
        let request = VerificationSourceStamp {
            archive_path: archive_path.clone(),
            source_size: metadata.len(),
            source_modified_at: modified_seconds(&metadata),
            source_sha256: None,
        };

        assert_eq!(
            verification_source_matches(request.clone()).unwrap(),
            Some(true)
        );
        fs::write(&archive_path, b"version two is longer").unwrap();
        assert_eq!(
            verification_source_matches(request.clone()).unwrap(),
            Some(false)
        );
        fs::remove_file(&archive_path).unwrap();
        assert_eq!(verification_source_matches(request).unwrap(), Some(false));
    }

    #[test]
    fn verification_source_match_is_unknown_without_a_modification_stamp() {
        // BE-VERIFY-FRESHNESS-MTIME-UNKNOWN
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("stampless.pna");
        fs::write(&archive_path, b"stampless").unwrap();
        let metadata = fs::metadata(&archive_path).unwrap();

        let matches = verification_source_matches(VerificationSourceStamp {
            archive_path: archive_path.clone(),
            source_size: metadata.len(),
            source_modified_at: None,
            source_sha256: None,
        })
        .unwrap();

        assert_eq!(matches, None);
    }

    #[test]
    fn verification_source_hash_detects_a_same_size_same_stamp_replacement() {
        // BE-REPORT-SOURCE-HASH-FRESHNESS
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("hash-stamped.pna");
        fs::write(&archive_path, b"version one").unwrap();
        let metadata = fs::metadata(&archive_path).unwrap();
        let request = VerificationSourceStamp {
            archive_path: archive_path.clone(),
            source_size: metadata.len(),
            source_modified_at: modified_seconds(&metadata),
            source_sha256: Some(sha256_file(&archive_path).unwrap()),
        };
        fs::write(&archive_path, b"version two").unwrap();

        assert_eq!(verification_source_matches(request).unwrap(), Some(false));
    }

    #[test]
    fn verification_source_hash_confirms_an_untouched_archive() {
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("hash-stamped-untouched.pna");
        fs::write(&archive_path, b"version one").unwrap();
        let metadata = fs::metadata(&archive_path).unwrap();
        let request = VerificationSourceStamp {
            archive_path: archive_path.clone(),
            source_size: metadata.len(),
            source_modified_at: modified_seconds(&metadata),
            source_sha256: Some(sha256_file(&archive_path).unwrap()),
        };

        assert_eq!(verification_source_matches(request).unwrap(), Some(true));
    }

    #[test]
    fn verification_checks_serialize_with_snake_case_wire_codes() {
        // BE-VERIFY-CHECK-WIRE-FORMAT
        let value = serde_json::to_value(failed_check(
            VerificationCheckCode::ArchiveHeader,
            None,
            "detail".into(),
        ))
        .unwrap();

        assert_eq!(value["code"], "archive_header");
        assert_eq!(value["status"], "failed");
    }
}
