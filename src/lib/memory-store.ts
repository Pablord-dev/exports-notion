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
import type { Store } from "@/lib/db";

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
