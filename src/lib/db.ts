// src/lib/db.ts — capa de datos sobre Postgres/Supabase (ADR 0006).
// Replica la interfaz de cache.ts para que sync.ts y las routes cambien mínimo.
// El "store" es inyectable (__setStore) igual que el __setClient de cache.ts;
// el fake de tests y el stub E2E implementan la interfaz Store completa.
import postgres from "postgres";
// Import circular sólo en apariencia: memory-store importa de aquí únicamente
// el tipo Store (type-only, se borra en runtime).
import { memoryStore } from "@/lib/memory-store";
import type { FlatRow, CacheMeta, SyncStatus } from "@/lib/types";

type Sql = ReturnType<typeof postgres>;

// ---- Mapeo fila plana → columnas tipadas ----
// Parte del setup por proyecto, igual que columns.ts: si estas propiedades
// cambian de nombre en Notion, actualizar aquí (y correr un Full).
const HOURS_COL = "Registro de horas";
const PERSON_ID_COL = "Hecho por (no tocar)";
const SUBPROJECT_ID_COL = "Subproyecto (no tocar)";
const PROJECT_ID_COL = "Proyecto (no tocar)";
const COMPANY_COL = "Empresa productiva";
const LAST_EDITED_COL = "Hora de última edición";
const dateCol = () => process.env.DATE_COLUMN ?? "Hora de creación";

function toHours(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toTimestamp(v: string | undefined): string | null {
  if (!v) return null;
  // Las propiedades tipo date pueden venir como rango "start → end": se toma el inicio.
  const start = v.split(" → ")[0];
  return Number.isNaN(Date.parse(start)) ? null : start;
}
function toId(v: string | undefined): string | null {
  return v || null;
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
}

// ---- Implementación Postgres ----
const UPSERT_CHUNK = 500;
const DELETE_CHUNK = 500;

// KV de control (sync_state): TTL emulado con expires_at — una fila vencida cuenta como ausente.
async function kvGet<T>(sql: Sql, key: string): Promise<T | null> {
  const rs = await sql`
    select value from sync_state
    where key = ${key} and (expires_at is null or expires_at > now())`;
  return rs.length ? (rs[0].value as T) : null;
}
async function kvSet(sql: Sql, key: string, value: unknown, ttlSec?: number) {
  // OJO: el valor va DIRECTO — con el cast ::jsonb postgres.js ya hace el
  // JSON.stringify; serializar a mano produce doble encoding (string en vez de JSON).
  await sql`
    insert into sync_state (key, value, expires_at)
    values (${key}, ${value as never}::jsonb,
            ${ttlSec ? sql`now() + make_interval(secs => ${ttlSec})` : null})
    on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`;
}
async function kvDel(sql: Sql, key: string) {
  await sql`delete from sync_state where key = ${key}`;
}

function pgStore(sql: Sql): Store {
  return {
    async upsertRows(rows, target = "current") {
      if (!rows.length) return;
      const table = target === "current" ? "pages" : "pages_new";
      const dc = dateCol();
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const slice = rows.slice(i, i + UPSERT_CHUNK);
        const ids: string[] = [], hours: number[] = [], created: (string | null)[] = [],
          person: (string | null)[] = [], subproject: (string | null)[] = [],
          project: (string | null)[] = [], company: (string | null)[] = [],
          edited: (string | null)[] = [], flatRows: FlatRow[] = [];
        for (const { id, row } of slice) {
          ids.push(id);
          hours.push(toHours(row[HOURS_COL]));
          created.push(toTimestamp(row[dc]));
          person.push(toId(row[PERSON_ID_COL]));
          subproject.push(toId(row[SUBPROJECT_ID_COL]));
          project.push(toId(row[PROJECT_ID_COL]));
          company.push(toId(row[COMPANY_COL]));
          edited.push(toTimestamp(row[LAST_EDITED_COL]));
          // El objeto va directo: con ::jsonb[] postgres.js serializa cada elemento
          // (stringify manual aquí = doble encoding, ver kvSet).
          flatRows.push(row);
        }
        await sql`
          insert into ${sql(table)} (id, hours, created_at, person_id, subproject_id, project_id, company, last_edited_at, row)
          select * from unnest(
            ${ids}::text[], ${hours}::numeric[], ${created}::timestamptz[],
            ${person}::text[], ${subproject}::text[], ${project}::text[],
            ${company}::text[], ${edited}::timestamptz[], ${flatRows as never}::jsonb[])
          on conflict (id) do update set
            hours = excluded.hours, created_at = excluded.created_at,
            person_id = excluded.person_id, subproject_id = excluded.subproject_id,
            project_id = excluded.project_id, company = excluded.company,
            last_edited_at = excluded.last_edited_at, row = excluded.row`;
      }
    },
    async deleteRows(ids, target = "current") {
      if (!ids.length) return;
      const table = target === "current" ? "pages" : "pages_new";
      for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        await sql`delete from ${sql(table)} where id = any(${ids.slice(i, i + DELETE_CHUNK)})`;
      }
    },
    async getAllRows() {
      const rs = await sql`select row from pages`;
      return rs.map((r) => r.row as FlatRow);
    },
    async countRows() {
      const rs = await sql`select count(*)::int as n from pages`;
      return rs[0].n as number;
    },
    async countRowsNew() {
      const rs = await sql`select count(*)::int as n from pages_new`;
      return rs[0].n as number;
    },
    async clearNewCache() {
      await sql`truncate pages_new`;
    },
    // Equivalente del RENAME atómico de Redis: dentro de una transacción el
    // cache vivo nunca se ve a medio construir. Copia (~20k filas) en vez de
    // DROP+RENAME para no invalidar el plan cache ni renombrar índices.
    async promoteNewCache() {
      await sql.begin(async (tx) => {
        await tx`truncate pages`;
        await tx`insert into pages select * from pages_new`;
        await tx`truncate pages_new`;
      });
    },

    async getMeta() {
      const v = await kvGet<CacheMeta>(sql, "meta");
      return v ?? { lastFullAt: null, lastIncrementalAt: null, count: 0 };
    },
    async setMeta(meta) { await kvSet(sql, "meta", meta); },

    async getStatus() {
      const v = await kvGet<SyncStatus>(sql, "status");
      return v ?? { state: "idle", kind: null, done: 0, total: 0, startedAt: null, error: null, skipped: 0 };
    },
    async setStatus(s) { await kvSet(sql, "status", s); },

    // Lock: el NX+EX de Redis se traduce a "insertar, o actualizar sólo si la fila venció".
    async acquireLock(ttlSec = 600) {
      const rs = await sql`
        insert into sync_state (key, value, expires_at)
        values ('lock', '"1"'::jsonb, now() + make_interval(secs => ${ttlSec}))
        on conflict (key) do update set expires_at = excluded.expires_at
        where sync_state.expires_at <= now()
        returning key`;
      return rs.length > 0;
    },
    async releaseLock() { await kvDel(sql, "lock"); },

    async requestCancel(ttlSec = 3600) { await kvSet(sql, "cancel", "1", ttlSec); },
    async isCancelRequested() { return (await kvGet(sql, "cancel")) !== null; },
    async clearCancel() { await kvDel(sql, "cancel"); },

    async getFullPivot() { return await kvGet<string>(sql, "full:pivot"); },
    async setFullPivot(p, ttlSec = 86_400) { await kvSet(sql, "full:pivot", p, ttlSec); },
    async clearFullPivot() { await kvDel(sql, "full:pivot"); },

    async getFullActive() { return await kvGet<string>(sql, "full:active"); },
    async setFullActive(startedAt, ttlSec = 86_400) { await kvSet(sql, "full:active", startedAt, ttlSec); },
    async clearFullActive() { await kvDel(sql, "full:active"); },

    // Ventana fija por IP: la fila (ip, inicio de ventana) acumula intentos.
    // El CTE purga ventanas viejas de paso (tabla chica, tráfico de login bajo).
    async rateLimitLogin(ip, limit = 5, windowSec = 900) {
      const rs = await sql`
        with cleanup as (
          delete from login_attempts
          where window_start < now() - 2 * make_interval(secs => ${windowSec})
        )
        insert into login_attempts (ip, window_start, count)
        values (${ip}, date_bin(make_interval(secs => ${windowSec}), now(), 'epoch'), 1)
        on conflict (ip, window_start) do update set count = login_attempts.count + 1
        returning count`;
      return (rs[0].count as number) <= limit;
    },
  };
}

// ---- Singleton + inyección ----
let sqlClient: Sql | null = null;
let store: Store | null = null;

function s(): Store {
  if (!store) {
    if (process.env.E2E_STUBS === "1") {
      // Playwright local sin Postgres real (mismo patrón que memory-redis).
      store = memoryStore();
    } else {
      sqlClient = postgres(process.env.DATABASE_URL!);
      store = pgStore(sqlClient);
    }
  }
  return store;
}

/** Para tests: inyectar un store fake (implementación completa de Store). */
export function __setStore(fake: Store | null) { store = fake; }

/** Cierra la conexión (scripts/CLI; el server no lo necesita). */
export async function closeDb() {
  if (sqlClient) { await sqlClient.end(); sqlClient = null; }
  store = null;
}

// ---- API pública (misma forma que cache.ts) ----
export const upsertRows: Store["upsertRows"] = (rows, target) => s().upsertRows(rows, target);
export const deleteRows: Store["deleteRows"] = (ids, target) => s().deleteRows(ids, target);
export const getAllRows: Store["getAllRows"] = () => s().getAllRows();
export const countRows: Store["countRows"] = () => s().countRows();
export const countRowsNew: Store["countRowsNew"] = () => s().countRowsNew();
export const clearNewCache: Store["clearNewCache"] = () => s().clearNewCache();
export const promoteNewCache: Store["promoteNewCache"] = () => s().promoteNewCache();
export const getMeta: Store["getMeta"] = () => s().getMeta();
export const setMeta: Store["setMeta"] = (m) => s().setMeta(m);
export const getStatus: Store["getStatus"] = () => s().getStatus();
export const setStatus: Store["setStatus"] = (st) => s().setStatus(st);
export async function patchStatus(p: Partial<SyncStatus>) {
  const cur = await getStatus();
  await setStatus({ ...cur, ...p });
}
export const acquireLock: Store["acquireLock"] = (ttl) => s().acquireLock(ttl);
export const releaseLock: Store["releaseLock"] = () => s().releaseLock();
export const requestCancel: Store["requestCancel"] = (ttl) => s().requestCancel(ttl);
export const isCancelRequested: Store["isCancelRequested"] = () => s().isCancelRequested();
export const clearCancel: Store["clearCancel"] = () => s().clearCancel();
export const getFullPivot: Store["getFullPivot"] = () => s().getFullPivot();
export const setFullPivot: Store["setFullPivot"] = (p, ttl) => s().setFullPivot(p, ttl);
export const clearFullPivot: Store["clearFullPivot"] = () => s().clearFullPivot();
export const getFullActive: Store["getFullActive"] = () => s().getFullActive();
export const setFullActive: Store["setFullActive"] = (v, ttl) => s().setFullActive(v, ttl);
export const clearFullActive: Store["clearFullActive"] = () => s().clearFullActive();
export const rateLimitLogin: Store["rateLimitLogin"] = (ip, limit, win) => s().rateLimitLogin(ip, limit, win);
