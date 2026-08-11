// src/lib/store-shared.ts — tipos y helpers compartidos entre la implementación
// Postgres (db.ts) y la de memoria (memory-store.ts). Vive aparte para que
// ninguna de las dos importe valores de la otra (evita el ciclo de módulos).
import type { FlatRow, CacheMeta, SyncStatus } from "@/lib/types";
import type { Role } from "@/lib/authz";

// ---- Mapeo de propiedades (setup por proyecto, igual que columns.ts) ----
export const HOURS_COL = "Registro de horas";
export const dateCol = () => process.env.DATE_COLUMN ?? "Hora de creación";

/** Propiedades (display) por las que agrupan/filtran los reportes. */
export const REPORT_PROPS = {
  // La dimensión "Persona" agrupa/filtra por el ID de la relación
  // "Hecho por (no tocar)" (estable aunque cambie el nombre) y MUESTRA el
  // nombre de "Hecho por" (2026-07-16: "Persona" no siempre trae el nombre).
  person: "Hecho por (no tocar)",
  personLabel: "Hecho por",
  // Respaldo del nombre cuando "Hecho por" viene vacío en todo el grupo.
  // Se descartan valores con pinta de UUID (a veces "Persona" trae el ID).
  personLabelFallback: "Persona",
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

/** Valores con pinta de ID de Notion: no sirven como nombre visible. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fin EXCLUSIVO del rango en UTC: `to` (YYYY-MM-DD, inclusive) + 1 día. */
export function toExclusiveEndUtc(to: string): string {
  return new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
}

// ---- Tipos de reportes (spec docs/reports/202607081002_reportes_v1_spec.md) ----
// Las dimensiones se agrupan/filtran por NOMBRE normalizado (trim), no por los IDs
// de relación: verificado contra datos reales (2026-07-13) que 18-29% de las filas
// tienen nombre sin ID — agrupar por ID partiría personas y subproyectos en dos.
export interface ReportFilters {
  /** YYYY-MM-DD inclusive, interpretado en UTC (igual que el export).
      Ausente = sin cota por ese lado (sin rango = todos los registros). */
  from?: string;
  to?: string;
  people?: string[];
  subprojects?: string[];
  projects?: string[];
  companies?: string[];
}
export interface PersonTotal {
  /** Clave de agrupación: ID de la relación (puede ser "" si no hay valor). */
  person: string;
  /** Nombre visible (max() de personLabel en el grupo); null si ninguno lo trae. */
  label: string | null;
  hours: number;
  count: number;
}
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
/** Celda del reporte matriz (dimensión × semana). `group` null = sin valor en la
    dimensión. `label` = nombre visible del grupo (solo dim person; null en el resto). */
export interface MatrixCell { group: string | null; label: string | null; bucket: string; hours: number; }
export interface DetailPage { rows: FlatRow[]; nextCursor: string | null; }
/** Opción de filtro con valor (clave real) y etiqueta visible. */
export interface FilterOption { value: string; label: string; }
export interface FilterOptions { people: FilterOption[]; subprojects: string[]; projects: string[]; companies: string[]; }

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
  /** Rate-limit del login: ventana FIJA por IP (no sliding window). */
  rateLimitLogin(ip: string, limit?: number, windowSec?: number): Promise<boolean>;

  /** Alta o refresco del usuario en el login. La fila nueva nace `viewer`; una
   *  existente conserva su rol (el upsert deja `role` fuera del do-update). */
  recordLogin(email: string, name: string): Promise<void>;
  /** `null` = sin fila. Quien llama lo resuelve con `roleOrDefault`. */
  getUserRole(email: string): Promise<Role | null>;
  /** Crea la fila si no existe: permite dejar listo a un admin antes de su primer login. */
  setUserRole(email: string, role: Role): Promise<void>;

  // Reportes (SB-12). Agregación al momento de consultar — sin precálculo.
  reportByPerson(f: ReportFilters): Promise<PersonTotal[]>;
  reportBySubproject(f: ReportFilters): Promise<SubprojectTotal[]>;
  reportTimeline(f: ReportFilters, granularity: "month" | "week"): Promise<TimelineBucket[]>;
  /** Matriz dimensión × semana ISO: horas agrupadas por (dim, semana) dentro de los filtros. */
  reportMatrix(f: ReportFilters, dim: "person" | "subproject"): Promise<MatrixCell[]>;
  reportDetail(f: ReportFilters, cursor: string | null, limit?: number): Promise<DetailPage>;
  reportFilters(): Promise<FilterOptions>;
}
