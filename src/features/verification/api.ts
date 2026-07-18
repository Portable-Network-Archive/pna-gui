import { invoke } from "@tauri-apps/api/core";
export type VerificationReportFormat = "json" | "html";
export type VerificationReportLocale = "en" | "ja";
export type VerificationReportExportErrorCode =
  | "conflict"
  | "permission_denied"
  | "storage_full"
  | "invalid_destination"
  | "invalid_report"
  | "report_missing"
  | "job_unavailable"
  | "io";

export interface VerificationReportExportError {
  code: VerificationReportExportErrorCode;
  message: string;
}

export interface VerificationReportExportResult {
  path: string;
}

const VERIFICATION_REPORT_EXPORT_ERROR_CODES =
  new Set<VerificationReportExportErrorCode>([
    "conflict",
    "permission_denied",
    "storage_full",
    "invalid_destination",
    "invalid_report",
    "report_missing",
    "job_unavailable",
    "io",
  ]);

export function normalizeReportExportError(
  caught: unknown,
): VerificationReportExportError {
  if (
    caught &&
    typeof caught === "object" &&
    "code" in caught &&
    "message" in caught &&
    VERIFICATION_REPORT_EXPORT_ERROR_CODES.has(
      (caught as { code: unknown }).code as VerificationReportExportErrorCode,
    ) &&
    typeof (caught as { message: unknown }).message === "string"
  ) {
    return caught as VerificationReportExportError;
  }
  return {
    code: "io",
    message: caught instanceof Error ? caught.message : String(caught),
  };
}

export const verificationReportApi = {
  export: (
    jobId: string,
    format: VerificationReportFormat,
    directory: string,
    locale: VerificationReportLocale,
  ) =>
    invoke<VerificationReportExportResult>("report_export_verification", {
      request: { jobId, format, directory, locale },
    }),
  reveal: (path: string) =>
    invoke<void>("report_reveal_export", {
      path,
    }),
};
