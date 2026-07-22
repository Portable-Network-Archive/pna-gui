"use client";

import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button, Dialog, DropdownMenu, Flex, Spinner } from "@radix-ui/themes";
import { formatBytes, formatCount } from "../archive/presentation";
import { type TranslationKey, useI18n } from "../i18n";
import {
  jobApi,
  type VerificationCheckCode,
  type VerificationCheckStatus,
  type VerificationReport,
} from "../jobs/api";
import styles from "./VerificationResultsDialog.module.css";
import {
  normalizeReportExportError,
  verificationReportApi,
  type VerificationReportExportErrorCode,
  type VerificationReportFormat,
} from "./api";
import { createSingleFlightGate } from "../singleFlight";

const CHECK_LABELS: Record<VerificationCheckCode, TranslationKey> = {
  archive_header: "checkArchiveHeader",
  chunk_integrity: "checkChunkIntegrity",
  entry_structure: "checkEntryStructure",
  file_contents: "checkFileContents",
  directory_entry: "checkDirectoryEntry",
  solid_contents: "checkSolidContents",
  link_entry: "checkLinkEntry",
  unsupported_entry: "checkUnsupportedEntry",
  entry_path: "checkEntryPath",
};

const STATUS_LABELS: Record<VerificationCheckStatus, TranslationKey> = {
  passed: "checkPassed",
  failed: "checkFailed",
  not_checked: "checkNotChecked",
};

type Freshness = "loading" | "fresh" | "stale" | "unknown";

export default function VerificationResultsDialog({
  open,
  jobId,
  report,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  jobId: string;
  report: VerificationReport;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { locale, t } = useI18n();
  const [freshness, setFreshness] = useState<Freshness>("loading");
  const [freshnessError, setFreshnessError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string>();
  const [exportError, setExportError] = useState<{
    summary: string;
    detail: string;
  }>();
  const exportGate = useMemo(createSingleFlightGate, []);
  const normalizedPath = report.archivePath.replaceAll("\\", "/");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  const archiveName = normalizedPath.slice(lastSlashIndex + 1);
  const parentPath =
    lastSlashIndex === -1
      ? "/"
      : normalizedPath.slice(0, lastSlashIndex) || "/";
  const orderedChecks = useMemo(
    () =>
      [...report.checks].sort((left, right) => {
        const order: Record<VerificationCheckStatus, number> = {
          failed: 0,
          not_checked: 1,
          passed: 2,
        };
        return order[left.status] - order[right.status];
      }),
    [report.checks],
  );
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void jobApi
      .verificationSourceMatches(report)
      .then((matches) => {
        if (disposed) return;
        setFreshnessError(null);
        setFreshness(
          matches === null ? "unknown" : matches ? "fresh" : "stale",
        );
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setFreshnessError(
          error instanceof Error ? error.message : String(error),
        );
        setFreshness("unknown");
      });
    return () => {
      disposed = true;
    };
  }, [open, report]);
  const conclusion =
    report.conclusion === "passed" && report.mode === "quick"
      ? t("quickVerificationCompleted")
      : {
          passed: t("verificationPassed"),
          issues_found: t("verificationIssuesFound"),
          incomplete: t("verificationIncomplete"),
        }[report.conclusion];
  const exportErrorLabel = (code: VerificationReportExportErrorCode): string =>
    ({
      conflict: t("verificationReportExportConflict"),
      permission_denied: t("verificationReportExportPermission"),
      storage_full: t("verificationReportExportStorage"),
      invalid_destination: t("verificationReportExportInvalid"),
      invalid_report: t("verificationReportExportInvalidReport"),
      report_missing: t("verificationReportExportReportMissing"),
      job_unavailable: t("verificationReportExportJobUnavailable"),
      io: t("verificationReportExportFailed"),
    })[code];
  const exportReport = (format: VerificationReportFormat) =>
    exportGate.run("report-export", async () => {
      try {
        const directory = await openDialog({
          title: t("saveVerificationReportTitle"),
          directory: true,
          multiple: false,
        });
        if (typeof directory !== "string") return;
        setExportError(undefined);
        setExporting(true);
        setExportPath(undefined);
        const result = await verificationReportApi.export(
          jobId,
          format,
          directory,
          locale,
        );
        setExportPath(result.path);
      } catch (caught) {
        const error = normalizeReportExportError(caught);
        setExportError({
          summary: exportErrorLabel(error.code),
          detail: error.message,
        });
      } finally {
        setExporting(false);
      }
    });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        className={styles.dialog}
        maxWidth="680px"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <Dialog.Title>{t("verificationResults")}</Dialog.Title>
        <Dialog.Description
          className={styles.source}
          aria-label={report.archivePath}
        >
          <strong>{archiveName}</strong>
          <span>{parentPath}</span>
        </Dialog.Description>
        {freshness === "stale" && (
          <p className={styles.staleNotice} role="status">
            {t("verificationResultStale")}
          </p>
        )}
        {freshness === "unknown" && (
          <div className={styles.staleNotice} role="status">
            <span>{t("verificationFreshnessUnknown")}</span>
            {freshnessError && (
              <details>
                <summary>{t("verificationTechnicalDetail")}</summary>
                <small>{freshnessError}</small>
              </details>
            )}
          </div>
        )}
        <section className={styles.summary} data-conclusion={report.conclusion}>
          <h2>{conclusion}</h2>
          <span>
            {report.mode === "quick"
              ? t("quickVerification")
              : t("completeVerification")}
          </span>
        </section>
        <dl className={styles.counts}>
          <div>
            <dt>{t("entriesChecked")}</dt>
            <dd>{formatCount(report.entriesChecked, locale)}</dd>
          </div>
          <div>
            <dt>{t("filesChecked")}</dt>
            <dd>{formatCount(report.filesChecked, locale)}</dd>
          </div>
          <div>
            <dt>{t("bytesChecked")}</dt>
            <dd>{formatBytes(report.bytesChecked, locale)}</dd>
          </div>
          <div>
            <dt>{t("failedChecks")}</dt>
            <dd>{formatCount(report.failedChecks, locale)}</dd>
          </div>
          <div>
            <dt>{t("notCheckedChecks")}</dt>
            <dd>{formatCount(report.notCheckedChecks, locale)}</dd>
          </div>
          <div>
            <dt>{t("verificationCompletedAt")}</dt>
            <dd className={styles.dateValue}>
              {report.completedAt > 0
                ? new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(report.completedAt * 1000))
                : "—"}
            </dd>
          </div>
        </dl>
        <ul className={styles.checks}>
          {orderedChecks.map((check, index) => (
            <li key={`${check.code}-${check.entryPath ?? "archive"}-${index}`}>
              <span className={styles.status} data-status={check.status}>
                {t(STATUS_LABELS[check.status])}
              </span>
              <span className={styles.checkInfo}>
                <strong>
                  {CHECK_LABELS[check.code]
                    ? t(CHECK_LABELS[check.code])
                    : check.code}
                </strong>
                {check.entryPath && <code>{check.entryPath}</code>}
                {check.detail && (
                  <details className={styles.technicalDetail}>
                    <summary>{t("verificationTechnicalDetail")}</summary>
                    <small>{check.detail}</small>
                  </details>
                )}
              </span>
            </li>
          ))}
        </ul>
        {report.checksOmitted > 0 && (
          <p className={styles.omitted} role="status">
            {t("additionalChecksNotShown").replace(
              "{count}",
              formatCount(report.checksOmitted, locale),
            )}
          </p>
        )}
        {exportPath && (
          <div className={styles.exportResult}>
            <span role="status">
              {t("verificationReportSaved").replace("{path}", exportPath)}
            </span>
            <Button
              type="button"
              size="1"
              variant="ghost"
              onClick={() => {
                void verificationReportApi
                  .reveal(exportPath)
                  .catch((caught: unknown) => {
                    const error = normalizeReportExportError(caught);
                    setExportError({
                      summary: exportErrorLabel(error.code),
                      detail: error.message,
                    });
                  });
              }}
            >
              {t("showInFolder")}
            </Button>
          </div>
        )}
        {exportError && (
          <div className={styles.exportError} role="alert">
            <span>{exportError.summary}</span>
            <details>
              <summary>{t("verificationTechnicalDetail")}</summary>
              <small>{exportError.detail}</small>
            </details>
          </div>
        )}
        <Flex gap="3" mt="5" justify="between">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button
                type="button"
                variant="soft"
                disabled={exporting || freshness === "loading"}
              >
                {exporting && <Spinner size="1" />}
                {t("saveVerificationReport")}
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={() => void exportReport("html")}>
                {t("reportHtml")}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => void exportReport("json")}>
                {t("reportJson")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <Dialog.Close>
            <Button type="button" variant="soft" color="gray">
              {t("close")}
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
