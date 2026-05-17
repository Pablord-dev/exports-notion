// src/lib/types.ts
export type FlatRow = Record<string, string>;

export interface CacheMeta {
  lastFullAt: string | null;       // ISO
  lastIncrementalAt: string | null; // ISO
  count: number;
}

export type SyncState = "idle" | "running" | "error";
export type SyncKind = "incremental" | "full";

export interface SyncStatus {
  state: SyncState;
  kind: SyncKind | null;
  done: number;
  total: number;
  startedAt: string | null;
  error: string | null;
  skipped: number;
}

export interface SyncStatusResponse {
  status: SyncStatus;
  meta: CacheMeta;
  next: { incremental: string; full: string };
}
