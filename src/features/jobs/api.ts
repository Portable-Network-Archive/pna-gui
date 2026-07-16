import { invoke } from "@tauri-apps/api/core";

export type JobStatus =
  | "queued"
  | "running"
  | "cancel_requested"
  | "cancelled"
  | "succeeded"
  | "failed"
  | "interrupted";

export type VerificationMode = "quick" | "complete";
export type VerificationConclusion = "passed" | "issues_found" | "incomplete";
export type VerificationCheckStatus = "passed" | "failed" | "not_checked";
export type VerificationCheckCode =
  | "archive_header"
  | "chunk_integrity"
  | "entry_structure"
  | "file_contents"
  | "directory_entry"
  | "solid_contents"
  | "link_entry"
  | "unsupported_entry"
  | "entry_path";

export interface VerificationCheck {
  code: VerificationCheckCode;
  status: VerificationCheckStatus;
  entryPath?: string | null;
  detail?: string | null;
}

export interface VerificationReport {
  archivePath: string;
  sourceSize: number;
  sourceModifiedAt?: number | null;
  completedAt: number;
  mode: VerificationMode;
  conclusion: VerificationConclusion;
  /** null when verification ended before the entry pass could determine it. */
  encrypted: boolean | null;
  solid: boolean | null;
  entriesChecked: number;
  filesChecked: number;
  bytesChecked: number;
  failedChecks: number;
  notCheckedChecks: number;
  checksOmitted: number;
  checks: VerificationCheck[];
}

export interface JobSnapshot {
  id: string;
  kind:
    | "create"
    | "extract"
    | "append"
    | "delete"
    | "rename"
    | "split"
    | "concat"
    | "sort"
    | "strip"
    | "migrate"
    | "verify";
  status: JobStatus;
  phase: string;
  currentItem?: string | null;
  completedUnits: number;
  totalUnits?: number | null;
  outputPath?: string | null;
  error?: string | null;
  errorCode?: string | null;
  warnings?: string[];
  verificationReport?: VerificationReport | null;
}

export interface CreateJobRequest {
  sources: string[];
  outputPath: string;
  overwrite: boolean;
  options: {
    solid: boolean;
    compression: "store" | "deflate" | "zstd" | "xz";
    encryption: "none" | "aes" | "camellia";
    password: string | null;
    preservePermissions: boolean;
    reproducible: boolean;
  };
}

export interface ExtractJobRequest {
  archivePath: string;
  destination: string;
  entries: string[];
  password: string | null;
  conflict: "ask" | "overwrite" | "skip" | "rename";
  restorePermissions: boolean;
  keepCompletedOnCancel: boolean;
}

export interface AppendJobRequest {
  archivePath: string;
  sources: string[];
  options: CreateJobRequest["options"];
}

export const jobApi = {
  startCreate: (request: CreateJobRequest) =>
    invoke<JobSnapshot>("job_start_create", { request }),
  startExtract: (request: ExtractJobRequest) =>
    invoke<JobSnapshot>("job_start_extract", { request }),
  startAppend: (request: AppendJobRequest) =>
    invoke<JobSnapshot>("job_start_append", { request }),
  startDelete: (request: {
    archivePath: string;
    entries: string[];
    password: string | null;
  }) => invoke<JobSnapshot>("job_start_delete_entries", { request }),
  startRename: (request: {
    archivePath: string;
    sourcePath: string;
    destinationPath: string;
    password: string | null;
  }) => invoke<JobSnapshot>("job_start_rename_entry", { request }),
  startSplit: (request: {
    archivePath: string;
    outputDirectory: string;
    maxPartBytes: number;
  }) => invoke<JobSnapshot>("job_start_split", { request }),
  startConcat: (request: { parts: string[]; outputPath: string }) =>
    invoke<JobSnapshot>("job_start_concat", { request }),
  startSort: (request: {
    archivePath: string;
    outputPath: string;
    password: string | null;
    descending: boolean;
  }) => invoke<JobSnapshot>("job_start_sort", { request }),
  startStrip: (request: {
    archivePath: string;
    outputPath: string;
    password: string | null;
    keepTimestamps: boolean;
    keepPermissions: boolean;
    keepXattrs: boolean;
    keepPrivateChunks: boolean;
  }) => invoke<JobSnapshot>("job_start_strip_metadata", { request }),
  startMigrate: (request: {
    archivePath: string;
    outputPath: string;
    password: string | null;
  }) => invoke<JobSnapshot>("job_start_migrate", { request }),
  startVerify: (request: {
    archivePath: string;
    password: string | null;
    mode: VerificationMode;
  }) => invoke<JobSnapshot>("job_start_verify", { request }),
  /** null when freshness could not be determined (no modification stamp). */
  verificationSourceMatches: (report: VerificationReport) =>
    invoke<boolean | null>("verification_source_matches", {
      request: {
        archivePath: report.archivePath,
        sourceSize: report.sourceSize,
        sourceModifiedAt: report.sourceModifiedAt ?? null,
      },
    }),
  list: () => invoke<JobSnapshot[]>("job_list"),
  cancel: (jobId: string) => invoke<JobSnapshot>("job_cancel", { jobId }),
  retry: (jobId: string) => invoke<JobSnapshot>("job_retry", { jobId }),
  dismiss: (jobId: string) => invoke<JobSnapshot[]>("job_dismiss", { jobId }),
  revealOutput: (jobId: string) => invoke<void>("job_reveal_output", { jobId }),
};
