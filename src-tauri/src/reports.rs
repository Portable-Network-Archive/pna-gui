use std::{
    fmt::Write as _,
    io::{self, Write},
    path::PathBuf,
};

use serde::{Deserialize, Serialize};

use crate::verification::{
    verification_source_matches, VerificationCheckCode, VerificationCheckStatus,
    VerificationConclusion, VerificationMode, VerificationReport, VerificationSourceStamp,
};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum VerificationSourceFreshness {
    Fresh,
    Stale,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationReportFormat {
    Json,
    Html,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VerificationReportLocale {
    En,
    Ja,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReportExportRequest {
    pub job_id: String,
    pub format: VerificationReportFormat,
    pub locale: VerificationReportLocale,
    pub directory: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReportExportResult {
    pub path: PathBuf,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationReportExportErrorCode {
    Conflict,
    PermissionDenied,
    StorageFull,
    InvalidDestination,
    InvalidReport,
    ReportMissing,
    JobUnavailable,
    Io,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReportExportError {
    pub code: VerificationReportExportErrorCode,
    pub message: String,
}

impl std::fmt::Display for VerificationReportExportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for VerificationReportExportError {}

impl VerificationReportExportError {
    pub fn invalid_report(message: String) -> Self {
        Self {
            code: VerificationReportExportErrorCode::InvalidReport,
            message,
        }
    }

    pub fn report_missing(message: String) -> Self {
        Self {
            code: VerificationReportExportErrorCode::ReportMissing,
            message,
        }
    }

    pub fn job_unavailable(message: String) -> Self {
        Self {
            code: VerificationReportExportErrorCode::JobUnavailable,
            message,
        }
    }
}

pub(crate) fn write_verification_report(
    report: VerificationReport,
    format: VerificationReportFormat,
    locale: VerificationReportLocale,
    destination: PathBuf,
) -> Result<VerificationReportExportResult, VerificationReportExportError> {
    validate_destination(&destination, format)?;
    validate_source_hash(&report)?;
    let source_freshness = source_freshness(&report);
    let archive_name = report
        .archive_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive.pna".into());
    let bytes = match format {
        VerificationReportFormat::Json => {
            let limitations = report_limitations(&report, locale);
            let document = serde_json::json!({
                "schemaVersion": 1,
                "product": {
                    "name": "Portable Network Archive",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "archive": {
                    "archiveName": archive_name,
                    "size": report.source_size,
                    "modifiedAt": report.source_modified_at,
                    "sha256": report.source_sha256,
                },
                "verification": {
                    "completedAt": report.completed_at,
                    "sourceFreshness": source_freshness,
                    "mode": report.mode,
                    "conclusion": report.conclusion,
                    "encrypted": report.encrypted,
                    "solid": report.solid,
                    "entriesChecked": report.entries_checked,
                    "filesChecked": report.files_checked,
                    "bytesChecked": report.bytes_checked,
                    "failedChecks": report.failed_checks,
                    "notCheckedChecks": report.not_checked_checks,
                    "checksOmitted": report.checks_omitted,
                    "limitations": limitations,
                    "checks": report.checks,
                },
            });
            serde_json::to_vec_pretty(&document)
                .map_err(|error| map_export_error(io::Error::other(error)))?
        }
        VerificationReportFormat::Html => {
            render_html_report(&report, &archive_name, locale, source_freshness)
        }
    };
    atomic_publish_new(&destination, &bytes).map_err(map_export_error)?;
    Ok(VerificationReportExportResult { path: destination })
}

pub fn export_verification_report(
    report: VerificationReport,
    format: VerificationReportFormat,
    locale: VerificationReportLocale,
    directory: PathBuf,
) -> Result<VerificationReportExportResult, VerificationReportExportError> {
    if !directory.is_dir() {
        return Err(VerificationReportExportError {
            code: VerificationReportExportErrorCode::InvalidDestination,
            message: "the selected report folder does not exist".into(),
        });
    }
    let stem = report
        .archive_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "archive".into());
    let extension = match format {
        VerificationReportFormat::Json => "json",
        VerificationReportFormat::Html => "html",
    };
    for number in 1..=10_000_u32 {
        let file_name = if number == 1 {
            format!("{stem}-verification.{extension}")
        } else {
            format!("{stem}-verification-{number}.{extension}")
        };
        let destination = directory.join(file_name);
        if destination.exists() {
            continue;
        }
        match write_verification_report(report.clone(), format, locale, destination) {
            Err(error) if error.code == VerificationReportExportErrorCode::Conflict => continue,
            result => return result,
        }
    }
    Err(VerificationReportExportError {
        code: VerificationReportExportErrorCode::Conflict,
        message: "no unused report file name is available in the selected folder".into(),
    })
}

fn report_limitations(
    report: &VerificationReport,
    locale: VerificationReportLocale,
) -> Vec<String> {
    let mut limitations = vec![match locale {
        VerificationReportLocale::En => {
            "This report does not test a restore destination, file attributes, or future readability."
        }
        VerificationReportLocale::Ja => {
            "このレポートは、展開先・ファイル属性・将来の読み取り可否を検証していません。"
        }
    }
    .into()];
    if matches!(report.mode, crate::verification::VerificationMode::Quick) {
        limitations.push(
            match locale {
                VerificationReportLocale::En => {
                    "Structure verification does not decrypt, decompress, or read file contents."
                }
                VerificationReportLocale::Ja => {
                    "構造検証では、復号・展開・ファイル内容の読み取りを行いません。"
                }
            }
            .into(),
        );
    }
    if report.not_checked_checks > 0 {
        limitations.push(
            match locale {
                VerificationReportLocale::En => {
                    "One or more applicable checks were not completed; see the check evidence."
                }
                VerificationReportLocale::Ja => {
                    "完了していない確認項目があります。確認内容の一覧を参照してください。"
                }
            }
            .into(),
        );
    }
    if report.checks_omitted > 0 {
        limitations.push(match locale {
            VerificationReportLocale::En => format!(
                "{} lower-priority check records were omitted from this bounded report.",
                report.checks_omitted
            ),
            VerificationReportLocale::Ja => format!(
                "この件数制限付きレポートでは、優先度の低い確認記録 {} 件を省略しています。",
                report.checks_omitted
            ),
        });
    }
    limitations
}

#[tauri::command]
pub fn report_reveal_export(path: PathBuf) -> Result<(), VerificationReportExportError> {
    if !path.is_file()
        || !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("json") || extension.eq_ignore_ascii_case("html")
            })
    {
        return Err(VerificationReportExportError::report_missing(
            "the exported verification report no longer exists".into(),
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        VerificationReportExportError::report_missing(
            "the exported verification report has no parent folder".into(),
        )
    })?;
    open::that(parent).map_err(map_export_error)
}

fn validate_destination(
    destination: &std::path::Path,
    format: VerificationReportFormat,
) -> Result<(), VerificationReportExportError> {
    let expected = match format {
        VerificationReportFormat::Json => "json",
        VerificationReportFormat::Html => "html",
    };
    if !destination
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected))
    {
        return Err(VerificationReportExportError {
            code: VerificationReportExportErrorCode::InvalidDestination,
            message: format!("the report file name must end in .{expected}"),
        });
    }
    Ok(())
}

fn validate_source_hash(report: &VerificationReport) -> Result<(), VerificationReportExportError> {
    if report.source_sha256.len() != 64
        || !report
            .source_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(VerificationReportExportError::invalid_report(
            "the verification result does not contain a valid SHA-256 identity".into(),
        ));
    }
    Ok(())
}

fn map_export_error(error: io::Error) -> VerificationReportExportError {
    let code = match error.kind() {
        io::ErrorKind::AlreadyExists => VerificationReportExportErrorCode::Conflict,
        io::ErrorKind::PermissionDenied => VerificationReportExportErrorCode::PermissionDenied,
        io::ErrorKind::StorageFull => VerificationReportExportErrorCode::StorageFull,
        io::ErrorKind::InvalidInput | io::ErrorKind::NotADirectory => {
            VerificationReportExportErrorCode::InvalidDestination
        }
        _ => VerificationReportExportErrorCode::Io,
    };
    VerificationReportExportError {
        code,
        message: error.to_string(),
    }
}

struct HtmlText {
    title: &'static str,
    archive_identity: &'static str,
    name: &'static str,
    size: &'static str,
    modified: &'static str,
    source_freshness: &'static str,
    verification_result: &'static str,
    completed: &'static str,
    mode: &'static str,
    conclusion: &'static str,
    entries: &'static str,
    files: &'static str,
    bytes: &'static str,
    failed: &'static str,
    not_checked: &'static str,
    omitted: &'static str,
    evidence: &'static str,
    status: &'static str,
    check: &'static str,
    entry: &'static str,
    detail: &'static str,
    limitations: &'static str,
    footer: &'static str,
    unknown: &'static str,
}

fn html_text(locale: VerificationReportLocale) -> HtmlText {
    match locale {
        VerificationReportLocale::En => HtmlText {
            title: "Verification report",
            archive_identity: "Archive identity",
            name: "Name",
            size: "Size (bytes)",
            modified: "Modified",
            source_freshness: "Source at export time",
            verification_result: "Verification result",
            completed: "Completed",
            mode: "Mode",
            conclusion: "Conclusion",
            entries: "Entries checked",
            files: "Files checked",
            bytes: "Decoded bytes checked",
            failed: "Failed checks",
            not_checked: "Not checked",
            omitted: "Checks omitted from this bounded report",
            evidence: "Check evidence",
            status: "Status",
            check: "Check",
            entry: "Entry",
            detail: "Detail",
            limitations: "Limitations",
            footer: "This report records only the checks listed above and does not certify future readability.",
            unknown: "unknown",
        },
        VerificationReportLocale::Ja => HtmlText {
            title: "検証レポート",
            archive_identity: "アーカイブ識別情報",
            name: "名前",
            size: "サイズ（バイト）",
            modified: "更新日時",
            source_freshness: "エクスポート時の元アーカイブ",
            verification_result: "検証結果",
            completed: "完了日時",
            mode: "検証範囲",
            conclusion: "結論",
            entries: "確認したエントリ",
            files: "読み取ったファイル",
            bytes: "読み取った展開後バイト数",
            failed: "失敗した確認",
            not_checked: "未確認",
            omitted: "件数制限により省略した確認",
            evidence: "確認内容",
            status: "状態",
            check: "確認項目",
            entry: "エントリ",
            detail: "詳細",
            limitations: "制限事項",
            footer: "このレポートは上記の確認内容のみを記録し、将来の読み取り可否を保証するものではありません。",
            unknown: "不明",
        },
    }
}

fn render_html_report(
    report: &VerificationReport,
    archive_name: &str,
    locale: VerificationReportLocale,
    source_freshness: VerificationSourceFreshness,
) -> Vec<u8> {
    let text = html_text(locale);
    let mut checks = String::new();
    for check in &report.checks {
        let _ = write!(
            checks,
            "<tr><td>{}</td><td>{}</td><td><code>{}</code></td><td>{}</td></tr>",
            escape_html(html_check_status(check.status, locale)),
            escape_html(html_check_code(check.code, locale)),
            escape_html(check.entry_path.as_deref().unwrap_or("—")),
            escape_html(check.detail.as_deref().unwrap_or("—")),
        );
    }
    let limitations = report_limitations(report, locale)
        .into_iter()
        .map(|limitation| format!("<li>{}</li>", escape_html(&limitation)))
        .collect::<String>();
    format!(
        concat!(
            "<!doctype html><html lang=\"{language}\"><head><meta charset=\"utf-8\">",
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">",
            "<title>{title} — {archive_name}</title>",
            "<style>body{{font:15px system-ui,sans-serif;color:#202124;max-width:960px;margin:40px auto;padding:0 24px}}",
            "h1{{font-size:24px}}h2{{font-size:18px;margin-top:32px}}",
            "dl{{display:grid;grid-template-columns:max-content 1fr;gap:8px 24px}}dt{{font-weight:600}}dd{{margin:0;overflow-wrap:anywhere}}",
            "table{{width:100%;border-collapse:collapse}}th,td{{padding:10px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}}",
            "code{{overflow-wrap:anywhere}}small{{color:#5f6368}}</style></head><body>",
            "<header><small>Portable Network Archive {version}</small><h1>{title}</h1></header>",
            "<section><h2>{archive_identity}</h2><dl>",
            "<dt>{name_label}</dt><dd>{archive_name}</dd><dt>{size_label}</dt><dd>{size}</dd>",
            "<dt>{modified_label}</dt><dd>{modified}</dd><dt>SHA-256</dt><dd><code>{sha256}</code></dd>",
            "<dt>{source_freshness_label}</dt><dd>{source_freshness}</dd></dl></section>",
            "<section><h2>{verification_result}</h2><dl>",
            "<dt>{completed_label}</dt><dd>{completed}</dd><dt>{mode_label}</dt><dd>{mode}</dd>",
            "<dt>{conclusion_label}</dt><dd>{conclusion}</dd><dt>{entries_label}</dt><dd>{entries}</dd>",
            "<dt>{files_label}</dt><dd>{files}</dd><dt>{bytes_label}</dt><dd>{bytes}</dd>",
            "<dt>{failed_label}</dt><dd>{failed}</dd><dt>{not_checked_label}</dt><dd>{not_checked}</dd>",
            "<dt>{omitted_label}</dt><dd>{omitted}</dd></dl></section>",
            "<section><h2>{evidence_label}</h2><table><thead><tr><th>{status_label}</th><th>{check_label}</th><th>{entry_label}</th><th>{detail_label}</th></tr></thead>",
            "<tbody>{checks}</tbody></table></section>",
            "<section><h2>{limitations_label}</h2><ul>{limitations}</ul></section>",
            "<footer><p><small>{footer}</small></p></footer>",
            "</body></html>"
        ),
        language = match locale {
            VerificationReportLocale::En => "en",
            VerificationReportLocale::Ja => "ja",
        },
        title = text.title,
        archive_identity = text.archive_identity,
        name_label = text.name,
        size_label = text.size,
        modified_label = text.modified,
        source_freshness_label = text.source_freshness,
        verification_result = text.verification_result,
        completed_label = text.completed,
        mode_label = text.mode,
        conclusion_label = text.conclusion,
        entries_label = text.entries,
        files_label = text.files,
        bytes_label = text.bytes,
        failed_label = text.failed,
        not_checked_label = text.not_checked,
        omitted_label = text.omitted,
        evidence_label = text.evidence,
        status_label = text.status,
        check_label = text.check,
        entry_label = text.entry,
        detail_label = text.detail,
        limitations_label = text.limitations,
        footer = text.footer,
        archive_name = escape_html(archive_name),
        version = escape_html(env!("CARGO_PKG_VERSION")),
        size = report.source_size,
        modified = report
            .source_modified_at
            .map(|value| format_timestamp(value, locale))
            .unwrap_or_else(|| text.unknown.into()),
        sha256 = escape_html(&report.source_sha256),
        completed = format_timestamp(report.completed_at, locale),
        source_freshness = escape_html(html_source_freshness(source_freshness, locale)),
        mode = escape_html(html_mode(report.mode, locale)),
        conclusion = escape_html(html_conclusion(report.conclusion, locale)),
        entries = report.entries_checked,
        files = report.files_checked,
        bytes = report.bytes_checked,
        failed = report.failed_checks,
        not_checked = report.not_checked_checks,
        omitted = report.checks_omitted,
        checks = checks,
        limitations = limitations,
    )
    .into_bytes()
}

fn source_freshness(report: &VerificationReport) -> VerificationSourceFreshness {
    match verification_source_matches(VerificationSourceStamp {
        archive_path: report.archive_path.clone(),
        source_size: report.source_size,
        source_modified_at: report.source_modified_at,
        source_sha256: Some(report.source_sha256.clone()),
    }) {
        Ok(Some(true)) => VerificationSourceFreshness::Fresh,
        Ok(Some(false)) => VerificationSourceFreshness::Stale,
        Ok(None) | Err(_) => VerificationSourceFreshness::Unknown,
    }
}

fn html_source_freshness(
    freshness: VerificationSourceFreshness,
    locale: VerificationReportLocale,
) -> &'static str {
    match (freshness, locale) {
        (VerificationSourceFreshness::Fresh, VerificationReportLocale::En) => {
            "Unchanged since verification"
        }
        (VerificationSourceFreshness::Fresh, VerificationReportLocale::Ja) => "検証時から変更なし",
        (VerificationSourceFreshness::Stale, VerificationReportLocale::En) => {
            "Changed since verification"
        }
        (VerificationSourceFreshness::Stale, VerificationReportLocale::Ja) => "検証後に変更あり",
        (VerificationSourceFreshness::Unknown, VerificationReportLocale::En) => {
            "Could not be confirmed"
        }
        (VerificationSourceFreshness::Unknown, VerificationReportLocale::Ja) => "確認できません",
    }
}

fn html_mode(mode: VerificationMode, locale: VerificationReportLocale) -> &'static str {
    match (mode, locale) {
        (VerificationMode::Quick, VerificationReportLocale::En) => "Structure verification",
        (VerificationMode::Quick, VerificationReportLocale::Ja) => "構造検証",
        (VerificationMode::Complete, VerificationReportLocale::En) => "Content verification",
        (VerificationMode::Complete, VerificationReportLocale::Ja) => "内容検証",
    }
}

fn html_conclusion(
    conclusion: VerificationConclusion,
    locale: VerificationReportLocale,
) -> &'static str {
    match (conclusion, locale) {
        (VerificationConclusion::Passed, VerificationReportLocale::En) => {
            "No issues found in the checked scope"
        }
        (VerificationConclusion::Passed, VerificationReportLocale::Ja) => "確認した範囲で問題なし",
        (VerificationConclusion::IssuesFound, VerificationReportLocale::En) => "Issues found",
        (VerificationConclusion::IssuesFound, VerificationReportLocale::Ja) => "問題あり",
        (VerificationConclusion::Incomplete, VerificationReportLocale::En) => {
            "Some applicable checks were not completed"
        }
        (VerificationConclusion::Incomplete, VerificationReportLocale::Ja) => {
            "完了していない確認あり"
        }
    }
}

fn html_check_status(
    status: VerificationCheckStatus,
    locale: VerificationReportLocale,
) -> &'static str {
    match (status, locale) {
        (VerificationCheckStatus::Passed, VerificationReportLocale::En) => "Checked",
        (VerificationCheckStatus::Passed, VerificationReportLocale::Ja) => "確認済み",
        (VerificationCheckStatus::Failed, VerificationReportLocale::En) => "Failed",
        (VerificationCheckStatus::Failed, VerificationReportLocale::Ja) => "失敗",
        (VerificationCheckStatus::NotChecked, VerificationReportLocale::En) => "Not checked",
        (VerificationCheckStatus::NotChecked, VerificationReportLocale::Ja) => "未確認",
    }
}

fn html_check_code(code: VerificationCheckCode, locale: VerificationReportLocale) -> &'static str {
    match (code, locale) {
        (VerificationCheckCode::ArchiveHeader, VerificationReportLocale::En) => "Archive header",
        (VerificationCheckCode::ArchiveHeader, VerificationReportLocale::Ja) => {
            "アーカイブヘッダー"
        }
        (VerificationCheckCode::ChunkIntegrity, VerificationReportLocale::En) => "Chunk integrity",
        (VerificationCheckCode::ChunkIntegrity, VerificationReportLocale::Ja) => "チャンク整合性",
        (VerificationCheckCode::EntryStructure, VerificationReportLocale::En) => "Entry structure",
        (VerificationCheckCode::EntryStructure, VerificationReportLocale::Ja) => "エントリ構造",
        (VerificationCheckCode::FileContents, VerificationReportLocale::En) => "File contents",
        (VerificationCheckCode::FileContents, VerificationReportLocale::Ja) => "ファイル内容",
        (VerificationCheckCode::DirectoryEntry, VerificationReportLocale::En) => "Directory entry",
        (VerificationCheckCode::DirectoryEntry, VerificationReportLocale::Ja) => {
            "ディレクトリエントリ"
        }
        (VerificationCheckCode::SolidContents, VerificationReportLocale::En) => {
            "Solid group contents"
        }
        (VerificationCheckCode::SolidContents, VerificationReportLocale::Ja) => {
            "Solidグループの内容"
        }
        (VerificationCheckCode::LinkEntry, VerificationReportLocale::En) => "Archive link",
        (VerificationCheckCode::LinkEntry, VerificationReportLocale::Ja) => "アーカイブ内リンク",
        (VerificationCheckCode::UnsupportedEntry, VerificationReportLocale::En) => {
            "Unsupported entry"
        }
        (VerificationCheckCode::UnsupportedEntry, VerificationReportLocale::Ja) => "未対応エントリ",
        (VerificationCheckCode::EntryPath, VerificationReportLocale::En) => "Entry path",
        (VerificationCheckCode::EntryPath, VerificationReportLocale::Ja) => "エントリのパス",
    }
}

fn format_timestamp(seconds: i64, locale: VerificationReportLocale) -> String {
    chrono::DateTime::from_timestamp(seconds, 0)
        .map(|date_time| match locale {
            VerificationReportLocale::En => date_time.format("%Y-%m-%d %H:%M:%S UTC").to_string(),
            VerificationReportLocale::Ja => {
                date_time.format("%Y年%m月%d日 %H:%M:%S UTC").to_string()
            }
        })
        .unwrap_or_else(|| seconds.to_string())
}

fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn atomic_publish_new(destination: &std::path::Path, bytes: &[u8]) -> io::Result<()> {
    let parent = destination.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the report destination has no parent directory",
        )
    })?;
    destination.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the report destination has no file name",
        )
    })?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(destination)
        .map(|_| ())
        .map_err(|error| error.error)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::verification::{
        VerificationCheck, VerificationCheckCode, VerificationCheckStatus, VerificationConclusion,
        VerificationMode, VerificationReport,
    };

    fn report() -> VerificationReport {
        VerificationReport {
            archive_path: "/private/tmp/session-42/project.pna".into(),
            source_size: 8192,
            source_modified_at: Some(1_784_160_000),
            source_sha256: "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac"
                .into(),
            completed_at: 1_784_160_300,
            mode: VerificationMode::Complete,
            conclusion: VerificationConclusion::Passed,
            encrypted: Some(true),
            solid: Some(false),
            entries_checked: 1,
            files_checked: 1,
            bytes_checked: 4096,
            failed_checks: 0,
            not_checked_checks: 0,
            checks: vec![VerificationCheck {
                code: VerificationCheckCode::FileContents,
                status: VerificationCheckStatus::Passed,
                entry_path: Some("documents/report.txt".into()),
                detail: Some("Read 4096 decoded bytes.".into()),
            }],
            checks_omitted: 0,
        }
    }

    #[test]
    fn json_report_has_stable_identity_without_local_or_secret_paths() {
        // BE-REPORT-JSON-IDENTITY
        let dir = tempdir().unwrap();
        let destination = dir.path().join("verification-report.json");
        let result = write_verification_report(
            report(),
            VerificationReportFormat::Json,
            VerificationReportLocale::En,
            destination.clone(),
        )
        .unwrap();

        assert_eq!(result.path, destination);
        let document = fs::read_to_string(&result.path).unwrap();
        assert!(document.contains("\"schemaVersion\": 1"));
        assert!(document.contains("\"archiveName\": \"project.pna\""));
        assert!(document.contains(
            "\"sha256\": \"f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac\""
        ));
        assert!(document.contains("\"status\": \"passed\""));
        assert!(document.contains("\"limitations\""));
        assert!(document.contains("does not test a restore destination"));
        assert!(document.contains("documents/report.txt"));
        assert!(!document.contains("/private/tmp"));
        assert!(!document.to_ascii_lowercase().contains("password"));
    }

    #[test]
    fn json_report_honors_the_requested_locale() {
        // BE-REPORT-JSON-LOCALE
        let dir = tempdir().unwrap();
        let destination = dir.path().join("verification-report.json");
        write_verification_report(
            report(),
            VerificationReportFormat::Json,
            VerificationReportLocale::Ja,
            destination.clone(),
        )
        .unwrap();

        let document = fs::read_to_string(&destination).unwrap();
        assert!(document.contains(
            "このレポートは、展開先・ファイル属性・将来の読み取り可否を検証していません。"
        ));
        assert!(!document.contains("does not test a restore destination"));
    }

    #[test]
    fn html_report_escapes_archive_controlled_content() {
        // BE-REPORT-HTML-ESCAPED
        let dir = tempdir().unwrap();
        let destination = dir.path().join("verification-report.html");
        let mut report = report();
        report.mode = VerificationMode::Quick;
        report.checks[0].entry_path = Some("<script>alert('entry')</script>.txt".into());
        report.checks[0].detail = Some("<img src=x onerror=alert('detail')>".into());

        write_verification_report(
            report,
            VerificationReportFormat::Html,
            VerificationReportLocale::Ja,
            destination.clone(),
        )
        .unwrap();

        let document = fs::read_to_string(destination).unwrap();
        assert!(document.starts_with("<!doctype html>"));
        assert!(document.contains("<html lang=\"ja\">"));
        assert!(document.contains("検証レポート"));
        assert!(document.contains("構造検証では、復号・展開・ファイル内容の読み取りを行いません。"));
        assert!(document.contains("2026"));
        // BE-REPORT-HTML-LOCALIZED-VALUES
        assert!(document.contains("<td>ファイル内容</td>"));
        assert!(document.contains("<td>確認済み</td>"));
        assert!(document.contains("<dd>構造検証</dd>"));
        assert!(document.contains("<dd>確認した範囲で問題なし</dd>"));
        assert!(!document.contains("<td>file_contents</td>"));
        assert!(!document.contains("<td>passed</td>"));
        assert!(document.contains("&lt;script&gt;alert(&#39;entry&#39;)&lt;/script&gt;.txt"));
        assert!(document.contains("&lt;img src=x onerror=alert(&#39;detail&#39;)&gt;"));
        assert!(!document.contains("<script>"));
        assert!(!document.contains("<img"));
        assert!(!document.contains("FileContents"));
        assert!(!document.contains("/private/tmp"));
    }

    #[test]
    fn html_report_renders_the_english_locale() {
        // BE-REPORT-HTML-ENGLISH-LOCALE
        let dir = tempdir().unwrap();
        let destination = dir.path().join("verification-report.html");

        write_verification_report(
            report(),
            VerificationReportFormat::Html,
            VerificationReportLocale::En,
            destination.clone(),
        )
        .unwrap();

        let document = fs::read_to_string(destination).unwrap();
        assert!(document.contains("<html lang=\"en\">"));
        assert!(document.contains("Verification report"));
    }

    #[test]
    fn exported_reports_record_when_the_verified_source_has_changed() {
        // BE-REPORT-FRESHNESS-EXPORT
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("project.pna");
        fs::write(&archive_path, vec![0_u8; 8192]).unwrap();
        let mut stale_report = report();
        stale_report.archive_path = archive_path;

        let json_path = dir.path().join("verification-report.json");
        write_verification_report(
            stale_report.clone(),
            VerificationReportFormat::Json,
            VerificationReportLocale::En,
            json_path.clone(),
        )
        .unwrap();
        let document: serde_json::Value =
            serde_json::from_slice(&fs::read(json_path).unwrap()).unwrap();
        assert_eq!(
            document["verification"]["sourceFreshness"],
            serde_json::json!("stale")
        );

        let html_path = dir.path().join("verification-report.html");
        write_verification_report(
            stale_report,
            VerificationReportFormat::Html,
            VerificationReportLocale::Ja,
            html_path.clone(),
        )
        .unwrap();
        assert!(fs::read_to_string(html_path)
            .unwrap()
            .contains("検証後に変更あり"));
    }

    #[test]
    fn export_conflict_preserves_existing_report_and_cleans_temporary_file() {
        // BE-REPORT-EXPORT-CONFLICT
        let dir = tempdir().unwrap();
        let destination = dir.path().join("verification-report.json");
        fs::write(&destination, b"existing evidence").unwrap();

        let error = write_verification_report(
            report(),
            VerificationReportFormat::Json,
            VerificationReportLocale::En,
            destination.clone(),
        )
        .unwrap_err();

        assert_eq!(error.code, VerificationReportExportErrorCode::Conflict);
        assert_eq!(fs::read(destination).unwrap(), b"existing evidence");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn export_error_kinds_remain_actionable_across_platforms() {
        // BE-REPORT-EXPORT-PERMISSION
        assert_eq!(
            map_export_error(io::Error::from(io::ErrorKind::PermissionDenied)).code,
            VerificationReportExportErrorCode::PermissionDenied
        );
        // BE-REPORT-EXPORT-STORAGE-FULL
        assert_eq!(
            map_export_error(io::Error::from(io::ErrorKind::StorageFull)).code,
            VerificationReportExportErrorCode::StorageFull
        );
    }

    #[test]
    fn report_format_must_match_the_destination_extension() {
        // BE-REPORT-EXPORT-INVALID-DESTINATION
        let dir = tempdir().unwrap();
        let destination = dir.path().join("verification-report.txt");

        let error = write_verification_report(
            report(),
            VerificationReportFormat::Json,
            VerificationReportLocale::En,
            destination,
        )
        .unwrap_err();

        assert_eq!(
            error.code,
            VerificationReportExportErrorCode::InvalidDestination
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn report_rejects_an_invalid_archive_identity_before_writing() {
        // BE-REPORT-HASH-VALIDATION
        let dir = tempdir().unwrap();
        let destination = dir.path().join("verification-report.json");
        let mut report = report();
        report.source_sha256 = "not-a-sha256".into();

        let error = write_verification_report(
            report,
            VerificationReportFormat::Json,
            VerificationReportLocale::En,
            destination,
        )
        .unwrap_err();

        assert_eq!(error.code, VerificationReportExportErrorCode::InvalidReport);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn reveal_export_reports_a_missing_file_distinctly_from_an_invalid_archive_identity() {
        // BE-REPORT-REVEAL-MISSING
        let dir = tempdir().unwrap();

        let missing =
            report_reveal_export(dir.path().join("verification-report.json")).unwrap_err();
        assert_eq!(
            missing.code,
            VerificationReportExportErrorCode::ReportMissing
        );

        let wrong_extension = dir.path().join("verification-report.txt");
        fs::write(&wrong_extension, b"not a report").unwrap();
        let mismatched = report_reveal_export(wrong_extension).unwrap_err();
        assert_eq!(
            mismatched.code,
            VerificationReportExportErrorCode::ReportMissing
        );
    }

    #[test]
    fn directory_export_uses_a_new_name_instead_of_overwriting() {
        // BE-REPORT-UNIQUE-NAME
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("project-verification.json"),
            b"existing evidence",
        )
        .unwrap();

        let result = export_verification_report(
            report(),
            VerificationReportFormat::Json,
            VerificationReportLocale::En,
            dir.path().to_path_buf(),
        )
        .unwrap();

        assert_eq!(
            result.path.file_name().and_then(|name| name.to_str()),
            Some("project-verification-2.json")
        );
        assert_eq!(
            fs::read(dir.path().join("project-verification.json")).unwrap(),
            b"existing evidence"
        );
    }

    #[test]
    fn export_rejects_a_destination_folder_that_no_longer_exists() {
        // BE-REPORT-EXPORT-MISSING-FOLDER
        let dir = tempdir().unwrap();
        let missing = dir.path().join("picked-then-deleted");

        let error = export_verification_report(
            report(),
            VerificationReportFormat::Json,
            VerificationReportLocale::En,
            missing,
        )
        .unwrap_err();

        assert_eq!(
            error.code,
            VerificationReportExportErrorCode::InvalidDestination
        );
    }

    #[test]
    fn json_report_preserves_each_verification_conclusion() {
        // BE-REPORT-CONCLUSION-STATES
        let dir = tempdir().unwrap();
        for (index, conclusion) in [
            VerificationConclusion::Passed,
            VerificationConclusion::IssuesFound,
            VerificationConclusion::Incomplete,
        ]
        .into_iter()
        .enumerate()
        {
            let mut report = report();
            report.conclusion = conclusion;
            let destination = dir.path().join(format!("conclusion-{index}.json"));
            write_verification_report(
                report,
                VerificationReportFormat::Json,
                VerificationReportLocale::En,
                destination.clone(),
            )
            .unwrap();
            let document: serde_json::Value =
                serde_json::from_slice(&fs::read(destination).unwrap()).unwrap();
            assert_eq!(
                document["verification"]["conclusion"],
                serde_json::to_value(conclusion).unwrap()
            );
        }
    }
}
