import type { SyncKind } from "@/lib/types";
import { fetchPages } from "@/lib/notion";
import { flattenPage } from "@/lib/flatten";
import {
  acquireLock, releaseLock, patchStatus, setStatus,
  upsertRows, deleteRows, clearNewCache, promoteNewCache,
  getMeta, setMeta, countRows,
} from "@/lib/cache";

const OVERLAP_MS = 60_000;

export async function runSync(kind: SyncKind): Promise<{ ok: true } | { ok: false; reason: string }> {
  const locked = await acquireLock();
  if (!locked) return { ok: false, reason: "locked" };

  const startedAt = new Date().toISOString();
  await setStatus({ state: "running", kind, done: 0, total: 0, startedAt, error: null, skipped: 0 });

  try {
    if (kind === "full") await runFull();
    else await runIncremental();
    await patchStatus({ state: "idle", kind: null, startedAt: null });
    return { ok: true };
  } catch (e: any) {
    await patchStatus({ state: "error", error: e?.message ?? String(e) });
    return { ok: false, reason: e?.message ?? String(e) };
  } finally {
    await releaseLock();
  }
}

async function runFull(): Promise<void> {
  await clearNewCache();
  let skipped = 0;
  const { pages } = await fetchPages({
    onProgress: async (done, total) => { await patchStatus({ done, total }); },
  });
  const batch: { id: string; row: any }[] = [];
  for (const p of pages) {
    try { batch.push({ id: p.id, row: flattenPage(p) }); }
    catch { skipped++; }
  }
  const now = new Date().toISOString();
  if (batch.length) {
    await upsertRows(batch, "new");
    await promoteNewCache();
    await setMeta({ lastFullAt: now, lastIncrementalAt: now, count: await countRows() });
  } else {
    // Notion devolvió 0 páginas — no promovemos para no borrar cache previo.
    // Sólo registramos que el poll corrió.
    const meta = await getMeta();
    await setMeta({ ...meta, lastFullAt: now });
  }
  await patchStatus({ skipped });
}

async function runIncremental(): Promise<void> {
  const meta = await getMeta();
  const since = meta.lastIncrementalAt
    ? new Date(new Date(meta.lastIncrementalAt).getTime() - OVERLAP_MS).toISOString()
    : null;

  let skipped = 0;
  const { pages, archivedIds } = await fetchPages({
    since,
    onProgress: async (done, total) => { await patchStatus({ done, total }); },
  });
  const batch: { id: string; row: any }[] = [];
  for (const p of pages) {
    try { batch.push({ id: p.id, row: flattenPage(p) }); }
    catch { skipped++; }
  }
  if (batch.length) await upsertRows(batch);
  if (archivedIds.length) await deleteRows(archivedIds);
  await setMeta({ ...meta, lastIncrementalAt: new Date().toISOString(), count: await countRows() });
  await patchStatus({ skipped });
}
