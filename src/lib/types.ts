// src/lib/types.ts
export type FlatRow = Record<string, string>;

export interface CacheMeta {
  lastFullAt: string | null;       // ISO
  lastIncrementalAt: string | null; // ISO
  count: number;
}

export type SyncState = "idle" | "running" | "error";
export type SyncKind = "incremental" | "full";

/** Resumen del último sync terminado (FX-003): qué corrió y cuánto procesó. */
export interface SyncLastResult {
  kind: SyncKind;
  upserted: number;
  deleted: number;
  skipped: number;
  finishedAt: string; // ISO
}

export interface SyncStatus {
  state: SyncState;
  kind: SyncKind | null;
  done: number;
  total: number;
  startedAt: string | null;
  error: string | null;
  skipped: number;
  lastResult?: SyncLastResult | null;
}

export interface SyncStatusResponse {
  status: SyncStatus;
  meta: CacheMeta;
  next: { incremental: string; full: string };
  /** Permisos ya resueltos en el server: la UI no ve roles, sólo booleanos. */
  perms: { full: boolean; cancel: boolean };
}
