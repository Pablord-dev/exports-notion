// src/lib/memory-store.ts
// Implementación en memoria de la interfaz Store de db.ts. Doble uso:
//   - tests de integración (db.__setStore(memoryStore()) — reemplaza a fakeRedis)
//   - E2E_STUBS=1 (Playwright local sin Postgres real, igual que memory-redis)
// Debe ser FIEL a la semántica del pgStore real (lección D1: un fake infiel
// ocultó un bug de producción): TTL vencido = ausente, promote reemplaza el
// vivo con el staging y lo vacía, lock NX retomable al vencer.
// Singleton en globalThis: en dev cada route puede compilar su propio module
// graph y un module-scope normal no compartiría estado entre handlers.
import type { FlatRow, CacheMeta, SyncStatus } from "@/lib/types";
import {
  HOURS_COL, REPORT_PROPS, dateCol, toHours, toTimestamp, toExclusiveEndUtc,
  encodeDetailCursor, decodeDetailCursor,
  type Store, type ReportFilters, type PersonTotal, type SubprojectTotal,
  type TimelineBucket, type DetailPage, type FilterOptions,
} from "@/lib/store-shared";

interface KvEntry { value: unknown; expiresAt: number | null; }

class MemoryStore implements Store {
  private pages = new Map<string, FlatRow>();
  private pagesNew = new Map<string, FlatRow>();
  private kv = new Map<string, KvEntry>();

  private table(target: "current" | "new") {
    return target === "current" ? this.pages : this.pagesNew;
  }
  private kvGet<T>(key: string): T | null {
    const e = this.kv.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) return null; // vencida = ausente
    return e.value as T;
  }
  private kvSet(key: string, value: unknown, ttlSec?: number) {
    this.kv.set(key, { value, expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null });
  }

  async upsertRows(rows: { id: string; row: FlatRow }[], target: "current" | "new" = "current") {
    const t = this.table(target);
    for (const { id, row } of rows) t.set(id, row);
  }
  async deleteRows(ids: string[], target: "current" | "new" = "current") {
    const t = this.table(target);
    for (const id of ids) t.delete(id);
  }
  async getAllRows() { return [...this.pages.values()]; }
  async countRows() { return this.pages.size; }
  async countRowsNew() { return this.pagesNew.size; }
  async clearNewCache() { this.pagesNew.clear(); }
  async promoteNewCache() {
    this.pages = this.pagesNew;
    this.pagesNew = new Map();
  }

  async getMeta(): Promise<CacheMeta> {
    return this.kvGet<CacheMeta>("meta") ?? { lastFullAt: null, lastIncrementalAt: null, count: 0 };
  }
  async setMeta(meta: CacheMeta) { this.kvSet("meta", meta); }

  async getStatus(): Promise<SyncStatus> {
    return this.kvGet<SyncStatus>("status")
      ?? { state: "idle", kind: null, done: 0, total: 0, startedAt: null, error: null, skipped: 0 };
  }
  async setStatus(s: SyncStatus) { this.kvSet("status", s); }

  async acquireLock(ttlSec = 600) {
    if (this.kvGet("lock") !== null) return false;
    this.kvSet("lock", "1", ttlSec);
    return true;
  }
  async releaseLock() { this.kv.delete("lock"); }

  async requestCancel(ttlSec = 3600) { this.kvSet("cancel", "1", ttlSec); }
  async isCancelRequested() { return this.kvGet("cancel") !== null; }
  async clearCancel() { this.kv.delete("cancel"); }

  async getFullPivot() { return this.kvGet<string>("full:pivot"); }
  async setFullPivot(p: string, ttlSec = 86_400) { this.kvSet("full:pivot", p, ttlSec); }
  async clearFullPivot() { this.kv.delete("full:pivot"); }

  async getFullActive() { return this.kvGet<string>("full:active"); }
  async setFullActive(startedAt: string, ttlSec = 86_400) { this.kvSet("full:active", startedAt, ttlSec); }
  async clearFullActive() { this.kv.delete("full:active"); }

  // ---- Reportes: misma semántica que el SQL de pgStore (trim, rango UTC
  // inclusivo, semana ISO lunes, keyset (created_at, id) desc). ----
  private norm(v: string | undefined): string { return (v ?? "").trim(); }
  private matching(f: ReportFilters): { id: string; row: FlatRow; created: number }[] {
    const from = Date.parse(`${f.from}T00:00:00Z`);
    const toEx = Date.parse(toExclusiveEndUtc(f.to));
    const out: { id: string; row: FlatRow; created: number }[] = [];
    for (const [id, row] of this.pages) {
      const ts = toTimestamp(row[dateCol()]);
      if (ts === null) continue;
      const created = Date.parse(ts);
      if (created < from || created >= toEx) continue;
      if (f.people?.length && !f.people.includes(this.norm(row[REPORT_PROPS.person]))) continue;
      if (f.subprojects?.length && !f.subprojects.includes(this.norm(row[REPORT_PROPS.subproject]))) continue;
      if (f.projects?.length && !f.projects.includes(this.norm(row[REPORT_PROPS.project]))) continue;
      if (f.companies?.length && !f.companies.includes(this.norm(row[REPORT_PROPS.company]))) continue;
      out.push({ id, row, created });
    }
    return out;
  }

  async reportByPerson(f: ReportFilters): Promise<PersonTotal[]> {
    const acc = new Map<string, { hours: number; count: number }>();
    for (const { row } of this.matching(f)) {
      const key = this.norm(row[REPORT_PROPS.person]);
      const g = acc.get(key) ?? { hours: 0, count: 0 };
      g.hours += toHours(row[HOURS_COL]); g.count++;
      acc.set(key, g);
    }
    return [...acc.entries()]
      .map(([person, g]) => ({ person, ...g }))
      .sort((a, b) => b.hours - a.hours || a.person.localeCompare(b.person));
  }

  async reportBySubproject(f: ReportFilters): Promise<SubprojectTotal[]> {
    const acc = new Map<string, SubprojectTotal>();
    for (const { row } of this.matching(f)) {
      const key = this.norm(row[REPORT_PROPS.subproject]) || null;
      const g = acc.get(key ?? "") ?? { subproject: key, project: null, company: null, hours: 0, count: 0 };
      const project = this.norm(row[REPORT_PROPS.project]) || null;
      const company = this.norm(row[REPORT_PROPS.company]) || null;
      // max() del grupo, como el SQL
      if (project && (!g.project || project > g.project)) g.project = project;
      if (company && (!g.company || company > g.company)) g.company = company;
      g.hours += toHours(row[HOURS_COL]); g.count++;
      acc.set(key ?? "", g);
    }
    return [...acc.values()].sort((a, b) =>
      b.hours - a.hours
      || (a.subproject === null ? 1 : b.subproject === null ? -1 : a.subproject.localeCompare(b.subproject)));
  }

  async reportTimeline(f: ReportFilters, granularity: "month" | "week"): Promise<TimelineBucket[]> {
    const acc = new Map<string, { hours: number; count: number }>();
    for (const { row, created } of this.matching(f)) {
      const d = new Date(created);
      let bucket: string;
      if (granularity === "month") {
        bucket = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      } else {
        const dayFromMonday = (d.getUTCDay() + 6) % 7; // ISO: lunes = 0
        const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dayFromMonday * 86_400_000;
        bucket = new Date(monday).toISOString().slice(0, 10);
      }
      const g = acc.get(bucket) ?? { hours: 0, count: 0 };
      g.hours += toHours(row[HOURS_COL]); g.count++;
      acc.set(bucket, g);
    }
    return [...acc.entries()].map(([bucket, g]) => ({ bucket, ...g })).sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  async reportDetail(f: ReportFilters, cursor: string | null, limit = 50): Promise<DetailPage> {
    const cur = decodeDetailCursor(cursor);
    let rows = this.matching(f).sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
    if (cur) {
      const c = Date.parse(cur.createdAt);
      rows = rows.filter((r) => r.created < c || (r.created === c && r.id < cur.id));
    }
    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit && page.length
      ? encodeDetailCursor({ createdAt: new Date(page[page.length - 1].created).toISOString(), id: page[page.length - 1].id })
      : null;
    return { rows: page.map((r) => r.row), nextCursor };
  }

  async reportFilters(): Promise<FilterOptions> {
    const dim = (prop: string) => {
      const set = new Set<string>();
      for (const row of this.pages.values()) {
        const v = this.norm(row[prop]);
        if (v) set.add(v);
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    };
    return {
      people: dim(REPORT_PROPS.person),
      subprojects: dim(REPORT_PROPS.subproject),
      projects: dim(REPORT_PROPS.project),
      companies: dim(REPORT_PROPS.company),
    };
  }

  private loginHits = new Map<string, { windowStart: number; count: number }>();
  async rateLimitLogin(ip: string, limit = 5, windowSec = 900) {
    const windowMs = windowSec * 1000;
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs; // misma ventana fija que date_bin
    const cur = this.loginHits.get(ip);
    if (!cur || cur.windowStart !== windowStart) {
      this.loginHits.set(ip, { windowStart, count: 1 });
      return true;
    }
    cur.count++;
    return cur.count <= limit;
  }
}

const G = globalThis as { __memoryStore?: MemoryStore };

/** Singleton para E2E (estado compartido entre handlers). */
export function memoryStore(): Store {
  G.__memoryStore ??= new MemoryStore();
  return G.__memoryStore;
}

/** Instancia fresca para tests (sin estado compartido entre casos). */
export function newMemoryStore(): Store {
  return new MemoryStore();
}
