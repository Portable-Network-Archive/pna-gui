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
  sourceSha256: string;
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
  /** False for restored jobs whose secret-bearing request was intentionally not persisted. */
  retryable?: boolean;
  warnings?: JobWarning[];
  verificationReport?: VerificationReport | null;
}

export interface JobWarning {
  code: string;
  technicalDetail: string;
  recoveryPath?: string | null;
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

const inFlight = new Map<string, Promise<unknown>>();

function createSecretTokenSalt(): string {
  const entropy = new Uint32Array(4);
  globalThis.crypto.getRandomValues(entropy);
  return Array.from(entropy, (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
}

const secretTokenSalt = createSecretTokenSalt();

function opaqueSecretToken(secret: string): string {
  // The token only separates concurrent requests. It is salted, short-lived,
  // never logged or persisted, and avoids placing a plaintext password in a
  // Map key while still distinguishing two materially different submissions.
  let hash = 0x811c9dc5;
  const input = `${secretTokenSalt}:${secret}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${secret.length}:${(hash >>> 0).toString(36)}`;
}

function requestIdentity(value: unknown): string {
  return JSON.stringify(value, (key, nested) =>
    key.toLowerCase().includes("password") && typeof nested === "string"
      ? `secret:${opaqueSecretToken(nested)}`
      : nested,
  );
}

function invokeSingleFlight<T>(
  command: string,
  identity: unknown,
  payload: Record<string, unknown>,
): Promise<T> {
  const key = JSON.stringify([command, requestIdentity(identity)]);
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = invoke<T>(command, payload).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export const jobApi = {
  startCreate: (request: CreateJobRequest) =>
    invokeSingleFlight<JobSnapshot>("job_start_create", request, {
      request,
    }),
  startExtract: (request: ExtractJobRequest) =>
    invokeSingleFlight<JobSnapshot>("job_start_extract", request, { request }),
  startAppend: (request: AppendJobRequest) =>
    invokeSingleFlight<JobSnapshot>("job_start_append", request, {
      request,
    }),
  startDelete: (request: {
    archivePath: string;
    entries: string[];
    password: string | null;
  }) =>
    invokeSingleFlight<JobSnapshot>("job_start_delete_entries", request, {
      request,
    }),
  startRename: (request: {
    archivePath: string;
    sourcePath: string;
    destinationPath: string;
    password: string | null;
  }) =>
    invokeSingleFlight<JobSnapshot>("job_start_rename_entry", request, {
      request,
    }),
  startSplit: (request: {
    archivePath: string;
    outputDirectory: string;
    maxPartBytes: number;
  }) =>
    invokeSingleFlight<JobSnapshot>("job_start_split", request, { request }),
  startConcat: (request: { parts: string[]; outputPath: string }) =>
    invokeSingleFlight<JobSnapshot>("job_start_concat", request, {
      request,
    }),
  startSort: (request: {
    archivePath: string;
    outputPath: string;
    password: string | null;
    descending: boolean;
  }) =>
    invokeSingleFlight<JobSnapshot>("job_start_sort", request, {
      request,
    }),
  startStrip: (request: {
    archivePath: string;
    outputPath: string;
    password: string | null;
    keepTimestamps: boolean;
    keepPermissions: boolean;
    keepXattrs: boolean;
    keepPrivateChunks: boolean;
  }) =>
    invokeSingleFlight<JobSnapshot>("job_start_strip_metadata", request, {
      request,
    }),
  startMigrate: (request: {
    archivePath: string;
    outputPath: string;
    password: string | null;
  }) =>
    invokeSingleFlight<JobSnapshot>("job_start_migrate", request, {
      request,
    }),
  startVerify: (request: {
    archivePath: string;
    password: string | null;
    mode: VerificationMode;
  }) =>
    invokeSingleFlight<JobSnapshot>("job_start_verify", request, { request }),
  /** null when freshness could not be determined (no modification stamp). */
  verificationSourceMatches: (report: VerificationReport) =>
    invoke<boolean | null>("verification_source_matches", {
      request: {
        archivePath: report.archivePath,
        sourceSize: report.sourceSize,
        sourceModifiedAt: report.sourceModifiedAt ?? null,
        sourceSha256: report.sourceSha256,
      },
    }),
  list: () => invoke<JobSnapshot[]>("job_list"),
  cancel: (jobId: string) =>
    invokeSingleFlight<JobSnapshot>("job_cancel", jobId, { jobId }),
  retry: (jobId: string) =>
    invokeSingleFlight<JobSnapshot>("job_retry", jobId, { jobId }),
  dismiss: (jobId: string) =>
    invokeSingleFlight<JobSnapshot[]>("job_dismiss", jobId, { jobId }),
  revealOutput: (jobId: string) =>
    invokeSingleFlight<void>("job_reveal_output", jobId, { jobId }),
};
