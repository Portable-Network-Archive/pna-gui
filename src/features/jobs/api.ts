import { invoke } from "@tauri-apps/api/core";

export type JobStatus =
  | "queued"
  | "running"
  | "cancel_requested"
  | "cancelled"
  | "succeeded"
  | "failed"
  | "interrupted";

export interface JobSnapshot {
  id: string;
  kind: "create" | "extract";
  status: JobStatus;
  phase: string;
  currentItem?: string | null;
  completedUnits: number;
  totalUnits?: number | null;
  outputPath?: string | null;
  error?: string | null;
  warnings?: string[];
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

export const jobApi = {
  startCreate: (request: CreateJobRequest) =>
    invoke<JobSnapshot>("job_start_create", { request }),
  startExtract: (request: ExtractJobRequest) =>
    invoke<JobSnapshot>("job_start_extract", { request }),
  list: () => invoke<JobSnapshot[]>("job_list"),
  cancel: (jobId: string) => invoke<JobSnapshot>("job_cancel", { jobId }),
  retry: (jobId: string) => invoke<JobSnapshot>("job_retry", { jobId }),
  dismiss: (jobId: string) => invoke<JobSnapshot[]>("job_dismiss", { jobId }),
  revealOutput: (jobId: string) => invoke<void>("job_reveal_output", { jobId }),
};
