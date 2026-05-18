import type { SyncKind } from "@/lib/types";
import { fetchPages, fetchOneFullSegment } from "@/lib/notion";
import { flattenPage } from "@/lib/flatten";
import {
  acquireLock, releaseLock, patchStatus, setStatus,
  upsertRows, deleteRows, clearNewCache, promoteNewCache,
  getMeta, setMeta, countRows, countRowsNew, clearCancel, isCancelRequested,
  getFullPivot, setFullPivot, clearFullPivot,
  isFullSessionActive, startFullSession, endFullSession,
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
    if (kind === "full") {
      return await runFullSegment();
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

async function runFullSegment(): Promise<SyncResult> {
  // Una sesión de full puede abarcar múltiples segmentos. Para evitar borrar el `new`
  // a la mitad si un segmento muere antes de fijar el pivote, usamos un flag de session
  // (independiente del pivote) que sólo se limpia al completar o cancelar.
  const sessionActive = await isFullSessionActive();
  const existingPivot = await getFullPivot();
  const isFirstSegmentOfSession = !sessionActive;

  if (isFirstSegmentOfSession) {
    // Inicio fresco: limpiar new, abrir session, limpiar cancel, marcar status.
    await clearNewCache();
    await startFullSession();
    await clearCancel();
    await setStatus({
      state: "running", kind: "full", done: 0, total: 0,
      startedAt: new Date().toISOString(), error: null, skipped: 0,
    });
  } else {
    // Reanudación: NO tocamos new ni el contador done (sigue acumulando).
    await patchStatus({ state: "running", kind: "full", error: null });
  }

  let skipped = 0;
  const { pages, archivedIds, nextPivot } = await fetchOneFullSegment({
    pivot: existingPivot ?? undefined,
    onProgress: async (done, total) => { await patchStatus({ done, total }); },
    shouldCancel: async () => await isCancelRequested(),
  });

  // Upsert antes de fijar el pivote: si morimos justo aquí, en la próxima llamada
  // el pivote será el viejo y se re-fetchearán algunas páginas (HSET es idempotente).
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
    return { ok: true, done: false, segmentCount: batch.length };
  }

  // Sesión termina: cancelado por usuario, o completado natural.
  const newCount = await countRowsNew();
  const now = new Date().toISOString();
  if (newCount > 0) {
    await promoteNewCache();
    await setMeta({ lastFullAt: now, lastIncrementalAt: now, count: await countRows() });
  } else {
    // 0 filas — no promovemos para no destruir el cache previo.
    const meta = await getMeta();
    await setMeta({ ...meta, lastFullAt: now });
  }
  await clearFullPivot();
  await endFullSession();
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
