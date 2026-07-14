import { invoke } from "@tauri-apps/api/core";
import type {
  AppErrorDto,
  ArchiveEntryPage,
  BootstrapSnapshot,
  EntryDetails,
  OpenArchiveResult,
  PreviewDescriptor,
  SortSpec,
} from "./types";

export function normalizeAppError(error: unknown): AppErrorDto {
  if (typeof error === "object" && error !== null && "message" in error) {
    const candidate = error as Partial<AppErrorDto>;
    return {
      code: candidate.code ?? "INTERNAL_ERROR",
      message: String(candidate.message),
      userAction: candidate.userAction,
      retryable: candidate.retryable ?? true,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message:
      typeof error === "string"
        ? error
        : "The operation could not be completed.",
    retryable: true,
  };
}

export const archiveApi = {
  bootstrap: () => invoke<BootstrapSnapshot>("app_bootstrap"),
  removeRecent: (path: string) =>
    invoke<BootstrapSnapshot["recent"]>("recent_remove", { path }),
  open: (path: string, password?: string) =>
    invoke<OpenArchiveResult>("archive_open", { path, password }),
  close: (handle: string) => invoke<void>("archive_close", { handle }),
  children: (
    handle: string,
    parentEntryId: string | undefined,
    cursor: string | undefined,
    sort: SortSpec,
  ) =>
    invoke<ArchiveEntryPage>("archive_children", {
      handle,
      parentEntryId,
      cursor,
      limit: 200,
      sort,
      filter: null,
    }),
  search: (handle: string, query: string, cursor?: string) =>
    invoke<ArchiveEntryPage>("archive_search", {
      handle,
      query,
      cursor,
      limit: 200,
    }),
  details: (handle: string, entryId: string) =>
    invoke<EntryDetails>("archive_entry_details", { handle, entryId }),
  preview: (handle: string, entryId: string) =>
    invoke<PreviewDescriptor>("archive_preview", {
      handle,
      entryId,
      maxBytes: 262_144,
    }),
};
