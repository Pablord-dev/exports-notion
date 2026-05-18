import { Redis } from "@upstash/redis";
import type { FlatRow, CacheMeta, SyncStatus } from "@/lib/types";

const CACHE_KEY = "notion:cache:v1";
const CACHE_KEY_NEW = "notion:cache:v1:new";
const META_KEY = "notion:meta";
const STATUS_KEY = "notion:sync:status";
const LOCK_KEY = "notion:sync:lock";
const CANCEL_KEY = "notion:sync:cancel";

let client: Redis | null = null;
function r(): Redis {
  if (!client) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return client;
}
/** Para tests: inyectar un cliente fake. */
export function __setClient(fake: Redis | null) { client = fake; }

// ---- Cache (hash) ----
const UPSERT_CHUNK = 500;
const DELETE_CHUNK = 500;
export async function upsertRows(rows: { id: string; row: FlatRow }[], target: "current" | "new" = "current") {
  const key = target === "current" ? CACHE_KEY : CACHE_KEY_NEW;
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const slice = rows.slice(i, i + UPSERT_CHUNK);
    const pairs: Record<string, string> = {};
    for (const { id, row } of slice) pairs[id] = JSON.stringify(row);
    await r().hset(key, pairs);
  }
}
export async function deleteRows(ids: string[], target: "current" | "new" = "current") {
  const key = target === "current" ? CACHE_KEY : CACHE_KEY_NEW;
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    await r().hdel(key, ...ids.slice(i, i + DELETE_CHUNK));
  }
}
export async function getAllRows(): Promise<FlatRow[]> {
  const rows: FlatRow[] = [];
  let cursor: string | number = 0;
  do {
    const [next, entries] = (await r().hscan(CACHE_KEY, cursor, { count: 500 })) as [string, unknown[]];
    for (let i = 1; i < entries.length; i += 2) {
      const v = entries[i];
      rows.push(typeof v === "string" ? JSON.parse(v) : (v as FlatRow));
    }
    cursor = next;
  } while (cursor !== "0" && cursor !== 0);
  return rows;
}
export async function countRows(): Promise<number> {
  return await r().hlen(CACHE_KEY);
}
export async function clearNewCache() { await r().del(CACHE_KEY_NEW); }
export async function promoteNewCache() { await r().rename(CACHE_KEY_NEW, CACHE_KEY); }

// ---- Meta ----
export async function getMeta(): Promise<CacheMeta> {
  const v = await r().get<CacheMeta>(META_KEY);
  return v ?? { lastFullAt: null, lastIncrementalAt: null, count: 0 };
}
export async function setMeta(meta: CacheMeta) { await r().set(META_KEY, meta); }

// ---- Status ----
export async function getStatus(): Promise<SyncStatus> {
  const v = await r().get<SyncStatus>(STATUS_KEY);
  return v ?? { state: "idle", kind: null, done: 0, total: 0, startedAt: null, error: null, skipped: 0 };
}
export async function setStatus(s: SyncStatus) { await r().set(STATUS_KEY, s); }
export async function patchStatus(p: Partial<SyncStatus>) {
  const cur = await getStatus();
  await setStatus({ ...cur, ...p });
}

// ---- Lock ----
export async function acquireLock(ttlSec = 600): Promise<boolean> {
  const ok = await r().set(LOCK_KEY, "1", { nx: true, ex: ttlSec });
  return ok === "OK";
}
export async function releaseLock() { await r().del(LOCK_KEY); }

// ---- Cancel ----
export async function requestCancel(ttlSec = 3600) { await r().set(CANCEL_KEY, "1", { ex: ttlSec }); }
export async function isCancelRequested(): Promise<boolean> { return (await r().get(CANCEL_KEY)) !== null; }
export async function clearCancel() { await r().del(CANCEL_KEY); }
