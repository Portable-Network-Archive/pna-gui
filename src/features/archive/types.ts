export interface AppErrorDto {
  code: string;
  message: string;
  userAction?: string;
  retryable: boolean;
  context?: string;
}

export interface ArchiveRecent {
  path: string;
  displayName: string;
  entryCount: number;
  storedBytes: number;
  lastOpenedAt: number;
}

export interface BootstrapSnapshot {
  productName: string;
  recent: ArchiveRecent[];
}

export interface ArchiveSummary {
  handle: string;
  path: string;
  displayName: string;
  entryCount: number;
  originalBytes: number;
  storedBytes: number;
  compressionMethods: string[];
  encryptionMethods: string[];
  solid: boolean;
  fileModifiedAt?: number | null;
}

export interface OpenArchiveResult {
  handle: string;
  summary: ArchiveSummary;
}

export type EntryKind = "file" | "directory" | "symlink" | "hardlink";

export interface ArchiveEntry {
  id: string;
  parentId?: string | null;
  path: string;
  name: string;
  kind: EntryKind;
  originalBytes?: number | null;
  storedBytes?: number | null;
  compression?: string | null;
  encryption?: string | null;
  modifiedAt?: number | null;
  hasChildren: boolean;
}

export interface ArchiveEntryPage {
  items: ArchiveEntry[];
  nextCursor?: string | null;
  totalCount: number;
}

export interface EntryDetails {
  entry: ArchiveEntry;
  createdAt?: number | null;
  accessedAt?: number | null;
  permission?: string | null;
  owner?: string | null;
  group?: string | null;
  xattrCount: number;
}

export interface PreviewDescriptor {
  kind: "text" | "unsupported";
  text?: string | null;
  byteCount: number;
  truncated: boolean;
  messageCode?:
    | "SELECT_FILE"
    | "UNSUPPORTED_TYPE"
    | "BINARY_DATA"
    | "TRUNCATED"
    | null;
}

export interface SortSpec {
  field: "name" | "kind" | "originalBytes" | "storedBytes" | "modifiedAt";
  direction: "asc" | "desc";
}

export interface FolderLocation {
  id?: string;
  name: string;
  path: string;
}
