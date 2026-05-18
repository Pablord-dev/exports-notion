import { Redis } from "@upstash/redis";
import type { FlatRow, CacheMeta, SyncStatus } from "@/lib/types";

const CACHE_KEY = "notion:cache:v1";
const CACHE_KEY_NEW = "notion:cache:v1:new";
const META_KEY = "notion:meta";
const STATUS_KEY = "notion:sync:status";
const LOCK_KEY = "notion:sync:lock";

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
export async function upsertRows(rows: { id: string; row: FlatRow }[], target: "current" | "new" = "current") {
  const key = target === "current" ? CACHE_KEY : CACHE_KEY_NEW;
  if (!rows.length) return;
  const pairs: Record<string, string> = {};
  for (const { id, row } of rows) pairs[id] = JSON.stringify(row);
  await r().hset(key, pairs);
}
export async function deleteRows(ids: string[], target: "current" | "new" = "current") {
  const key = target === "current" ? CACHE_KEY : CACHE_KEY_NEW;
  if (!ids.length) return;
  await r().hdel(key, ...ids);
}
export async function getAllRows(): Promise<FlatRow[]> {
  const all = (await r().hvals(CACHE_KEY)) as string[];
  return all.map((s) => JSON.parse(s));
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
