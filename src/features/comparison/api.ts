import { invoke } from "@tauri-apps/api/core";
import type { DifferenceKind, ComparisonResult } from "../jobs/api";

export interface ComparisonItem {
  kind: string;
  size?: number | null;
  createdAt?: number | null;
  modifiedAt?: number | null;
  accessedAt?: number | null;
  permission?: string | null;
  owner?: string | null;
  group?: string | null;
  xattrs: string[];
  compression?: string | null;
  encryption?: string | null;
  contentSha256?: string | null;
}

export interface MetadataDifference {
  field: string;
  left?: string | null;
  right?: string | null;
}

export interface ComparisonDifference {
  path: string;
  kind: DifferenceKind;
  left?: ComparisonItem | null;
  right?: ComparisonItem | null;
  metadataDifferences: MetadataDifference[];
  detail?: string | null;
}

export interface ComparisonPage {
  items: ComparisonDifference[];
  nextCursor?: number | null;
  totalCount: number;
}

export interface ComparisonPageRequest {
  jobId: string;
  kinds: DifferenceKind[];
  query: string;
  cursor?: number | null;
  limit?: number | null;
}

export const comparisonApi = {
  page: (request: ComparisonPageRequest) =>
    invoke<ComparisonPage>("comparison_page", { request }),
};

export type { ComparisonResult };
