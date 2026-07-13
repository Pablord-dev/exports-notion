// src/lib/store-shared.ts — tipos y helpers compartidos entre la implementación
// Postgres (db.ts) y la de memoria (memory-store.ts). Vive aparte para que
// ninguna de las dos importe valores de la otra (evita el ciclo de módulos).
import type { FlatRow, CacheMeta, SyncStatus } from "@/lib/types";

// ---- Mapeo de propiedades (setup por proyecto, igual que columns.ts) ----
export const HOURS_COL = "Registro de horas";
export const dateCol = () => process.env.DATE_COLUMN ?? "Hora de creación";

/** Propiedades (display) por las que agrupan/filtran los reportes. */
export const REPORT_PROPS = {
  person: "Persona",
  subproject: "Subproyecto",
  project: "Proyecto",
  company: "Empresa productiva",
} as const;

// ---- Parseo fila plana → valores tipados ----
export function toHours(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
export function toTimestamp(v: string | undefined): string | null {
  if (!v) return null;
  // Las propiedades tipo date pueden venir como rango "start → end": se toma el inicio.
  const start = v.split(" → ")[0];
  return Number.isNaN(Date.parse(start)) ? null : start;
}

/** Fin EXCLUSIVO del rango en UTC: `to` (YYYY-MM-DD, inclusive) + 1 día. */
export function toExclusiveEndUtc(to: string): string {
  return new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
}

// ---- Tipos de reportes (spec docs/reports/202607081002_reportes_v1_spec.md) ----
// Las dimensiones se agrupan/filtran por NOMBRE normalizado (trim), no por los IDs
// de relación: verificado contra datos reales (2026-07-13) que 18-29% de las filas
// tienen nombre sin ID — agrupar por ID partiría personas y subproyectos en dos.
export interface ReportFilters {
  /** YYYY-MM-DD inclusive, interpretado en UTC (igual que el export). */
  from: string;
  to: string;
  people?: string[];
  subprojects?: string[];
  projects?: string[];
  companies?: string[];
}
export interface PersonTotal { person: string; hours: number; count: number; }
export interface SubprojectTotal {
  /** null = registros sin subproyecto (no se pierden, spec §Reportes). */
  subproject: string | null;
  /** Etiquetas informativas (max() del grupo). */
  project: string | null;
  company: string | null;
  hours: number;
  count: number;
}
export interface TimelineBucket { bucket: string; hours: number; count: number; }
export interface DetailPage { rows: FlatRow[]; nextCursor: string | null; }
export interface FilterOptions { people: string[]; subprojects: string[]; projects: string[]; companies: string[]; }

// ---- Cursor keyset del detail: (created_at, id) de la última fila entregada ----
export interface DetailCursor { createdAt: string; id: string; }
export function encodeDetailCursor(c: DetailCursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id])).toString("base64url");
}
export function decodeDetailCursor(cursor: string | null): DetailCursor | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof createdAt !== "string" || typeof id !== "string" || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// ---- Interfaz del store (la que fakes y stubs deben implementar) ----
export interface Store {
  upsertRows(rows: { id: string; row: FlatRow }[], target?: "current" | "new"): Promise<void>;
  deleteRows(ids: string[], target?: "current" | "new"): Promise<void>;
  getAllRows(): Promise<FlatRow[]>;
  countRows(): Promise<number>;
  countRowsNew(): Promise<number>;
  clearNewCache(): Promise<void>;
  promoteNewCache(): Promise<void>;
  getMeta(): Promise<CacheMeta>;
  setMeta(meta: CacheMeta): Promise<void>;
  getStatus(): Promise<SyncStatus>;
  setStatus(s: SyncStatus): Promise<void>;
  acquireLock(ttlSec?: number): Promise<boolean>;
  releaseLock(): Promise<void>;
  requestCancel(ttlSec?: number): Promise<void>;
  isCancelRequested(): Promise<boolean>;
  clearCancel(): Promise<void>;
  getFullPivot(): Promise<string | null>;
  setFullPivot(p: string, ttlSec?: number): Promise<void>;
  clearFullPivot(): Promise<void>;
  getFullActive(): Promise<string | null>;
  setFullActive(startedAt: string, ttlSec?: number): Promise<void>;
  clearFullActive(): Promise<void>;
  /** Rate-limit del login: ventana FIJA por IP (sucesor del sliding window de Upstash). */
  rateLimitLogin(ip: string, limit?: number, windowSec?: number): Promise<boolean>;

  // Reportes (SB-12). Agregación al momento de consultar — sin precálculo.
  reportByPerson(f: ReportFilters): Promise<PersonTotal[]>;
  reportBySubproject(f: ReportFilters): Promise<SubprojectTotal[]>;
  reportTimeline(f: ReportFilters, granularity: "month" | "week"): Promise<TimelineBucket[]>;
  reportDetail(f: ReportFilters, cursor: string | null, limit?: number): Promise<DetailPage>;
  reportFilters(): Promise<FilterOptions>;
}
