import type { SyncKind } from "@/lib/types";
import { fetchPages, fetchOneFullSegment } from "@/lib/notion";
import { flattenPage } from "@/lib/flatten";
import {
  acquireLock, releaseLock, patchStatus, setStatus,
  upsertRows, deleteRows, clearNewCache, promoteNewCache,
  getMeta, setMeta, countRows, countRowsNew, clearCancel, isCancelRequested,
  getFullPivot, setFullPivot, clearFullPivot,
} from "@/lib/cache";

const OVERLAP_MS = 60_000;

export type SyncResult =
  | { ok: true; done: true }
  | { ok: true; done: false; segmentCount: number } // sólo full
  | { ok: false; reason: string };

export async function runSync(kind: SyncKind): Promise<SyncResult> {
  const locked = await acquireLock();
  if (!locked) return { ok: false, reason: "locked" };

  try {
    // No reseteamos el flag de cancel al inicio de cada segmento del full —
    // sólo en el primer segmento (cuando no hay pivote). El cancel debe sobrevivir
    // entre segmentos para que el usuario pueda abortar mid-flight.
    if (kind === "full") {
      const existingPivot = await getFullPivot();
      if (!existingPivot) await clearCancel();
      return await runFullSegment(existingPivot);
    } else {
      await clearCancel();
      return await runIncremental();
    }
  } catch (e: any) {
    await patchStatus({ state: "error", error: e?.message ?? String(e) });
    return { ok: false, reason: e?.message ?? String(e) };
  } finally {
    await releaseLock();
  }
}

async function runFullSegment(existingPivot: string | null): Promise<SyncResult> {
  const isFirstSegment = !existingPivot;
  const startedAt = isFirstSegment ? new Date().toISOString() : null;

  if (isFirstSegment) {
    await clearNewCache();
    await setStatus({ state: "running", kind: "full", done: 0, total: 0, startedAt, error: null, skipped: 0 });
  } else {
    await patchStatus({ state: "running", kind: "full", error: null });
  }

  let skipped = 0;
  const { pages, archivedIds, nextPivot } = await fetchOneFullSegment({
    pivot: existingPivot ?? undefined,
    onProgress: async (done, total) => { await patchStatus({ done, total }); },
    shouldCancel: async () => await isCancelRequested(),
  });

  const batch: { id: string; row: any }[] = [];
  for (const p of pages) {
    try { batch.push({ id: p.id, row: flattenPage(p) }); }
    catch { skipped++; }
  }
  if (batch.length) await upsertRows(batch, "new");

  const cancelled = await isCancelRequested();
  const moreSegmentsPending = !!nextPivot && !cancelled;

  if (moreSegmentsPending) {
    await setFullPivot(nextPivot!);
    await patchStatus({ skipped });
    // Sigue "running" — el cliente verá `done:false` en la respuesta y volverá a llamar.
    return { ok: true, done: false, segmentCount: batch.length };
  }

  // Completado (o cancelado): promovemos si tenemos algo.
  const newCount = await countRowsNew();
  const now = new Date().toISOString();
  if (newCount > 0) {
    await promoteNewCache();
    await setMeta({ lastFullAt: now, lastIncrementalAt: now, count: await countRows() });
  } else {
    // 0 páginas en total — no promovemos, conservamos el cache previo.
    const meta = await getMeta();
    await setMeta({ ...meta, lastFullAt: now });
  }
  await clearFullPivot();
  await patchStatus({ state: "idle", kind: null, startedAt: null, skipped });
  return { ok: true, done: true };
}

async function runIncremental(): Promise<SyncResult> {
  const meta = await getMeta();
  const since = meta.lastIncrementalAt
    ? new Date(new Date(meta.lastIncrementalAt).getTime() - OVERLAP_MS).toISOString()
    : null;

  const startedAt = new Date().toISOString();
  await setStatus({ state: "running", kind: "incremental", done: 0, total: 0, startedAt, error: null, skipped: 0 });

  let skipped = 0;
  const { pages, archivedIds } = await fetchPages({
    since,
    onProgress: async (done, total) => { await patchStatus({ done, total }); },
    shouldCancel: async () => await isCancelRequested(),
  });
  const batch: { id: string; row: any }[] = [];
  for (const p of pages) {
    try { batch.push({ id: p.id, row: flattenPage(p) }); }
    catch { skipped++; }
  }
  if (batch.length) await upsertRows(batch);
  if (archivedIds.length) await deleteRows(archivedIds);
  await setMeta({ ...meta, lastIncrementalAt: new Date().toISOString(), count: await countRows() });
  await patchStatus({ state: "idle", kind: null, startedAt: null, skipped });
  return { ok: true, done: true };
}
