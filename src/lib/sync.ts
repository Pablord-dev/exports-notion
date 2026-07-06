import type { SyncKind, SyncLastResult } from "@/lib/types";
import { fetchPages, fetchFullBatches } from "@/lib/notion";
import { flattenPage } from "@/lib/flatten";
import {
  acquireLock, releaseLock, patchStatus, setStatus,
  upsertRows, deleteRows, clearNewCache, promoteNewCache,
  getMeta, setMeta, countRows, countRowsNew, clearCancel, isCancelRequested,
  getFullPivot, setFullPivot, clearFullPivot,
  getFullActive, setFullActive, clearFullActive,
} from "@/lib/cache";

const OVERLAP_MS = 60_000;
// Eco del page_size de notion.ts, sólo para estimar `total` en el status.
const BATCH_SIZE = 100;

export type SyncResult =
  | { ok: true; done: true; upserted: number; deleted: number }
  | { ok: true; done: false; segmentCount: number } // sólo full con presupuesto agotado
  | { ok: false; reason: string };

export async function runSync(kind: SyncKind): Promise<SyncResult> {
  const locked = await acquireLock();
  if (!locked) return { ok: false, reason: "locked" };

  try {
    if (kind === "full") {
      // El cancel NO se resetea aquí: debe sobrevivir entre invocaciones encadenadas
      // del full para que el usuario pueda abortar mid-flight. Se limpia al abrir
      // una sesión nueva (dentro de runFull).
      return await runFull();
    }
    await clearCancel();
    return await runIncremental();
  } catch (e: any) {
    await patchStatus({ state: "error", error: e?.message ?? String(e) });
    return { ok: false, reason: e?.message ?? String(e) };
  } finally {
    await releaseLock();
  }
}

async function runFull(): Promise<SyncResult> {
  const callStart = Date.now();
  const budgetMs = Number(process.env.SYNC_BUDGET_MS);
  const hasBudget = Number.isFinite(budgetMs);

  // Una "sesión" de full va desde el arranque hasta promover (o cancelar), y puede
  // abarcar varias invocaciones si hay presupuesto de tiempo. El flag en Redis (valor =
  // startedAt) es lo que distingue sesión nueva de reanudación — NO la ausencia de
  // pivote: así, si la función muere antes de fijar el primer pivote, el siguiente
  // intento reanuda en vez de borrar el `:new` acumulado (FX-004/D3).
  const active = await getFullActive();
  const isNewSession = !active;
  const sessionStart = active ?? new Date().toISOString();
  let pivot: string | null = null;

  if (isNewSession) {
    await clearCancel();
    await clearNewCache();
    await clearFullPivot();
    await setFullActive(sessionStart);
    await setStatus({ state: "running", kind: "full", done: 0, total: 0, startedAt: sessionStart, error: null, skipped: 0 });
  } else {
    pivot = await getFullPivot();
    await patchStatus({ state: "running", kind: "full", error: null });
  }

  let skipped = 0;
  let upserted = 0;
  let processed = 0;

  const run = await fetchFullBatches({
    pivot: pivot ?? undefined,
    shouldCancel: async () => await isCancelRequested(),
    budgetExhausted: () => hasBudget && Date.now() - callStart >= budgetMs,
    onBatch: async (batchPages, lastCreatedTime, hasMore) => {
      const rows: { id: string; row: Record<string, string> }[] = [];
      for (const p of batchPages) {
        try { rows.push({ id: p.id, row: flattenPage(p) }); }
        catch { skipped++; }
      }
      if (rows.length) await upsertRows(rows, "new");
      upserted += rows.length;
      processed += batchPages.length;
      // Checkpoint por batch: si la función muere aquí, la siguiente invocación
      // reanuda desde este pivote conservando todo lo ya upserteado al :new.
      if (lastCreatedTime) await setFullPivot(lastCreatedTime);
      await patchStatus({ done: processed, total: processed + (hasMore ? BATCH_SIZE : 0), skipped });
    },
  });

  if (!run.completed && !run.cancelled) {
    // Presupuesto agotado: el status queda "running"; el cliente encadena otra llamada.
    return { ok: true, done: false, segmentCount: processed };
  }

  // Dataset completo (o cancelado): cerrar la sesión promoviendo lo cargado.
  const newCount = await countRowsNew();
  const now = new Date().toISOString();
  if (newCount > 0) {
    await promoteNewCache();
    // lastIncrementalAt = inicio de la sesión (no `now`): las ediciones hechas DURANTE
    // el full — que pudo durar varias invocaciones — entran en la ventana del próximo
    // incremental en vez de perderse (FX-002).
    await setMeta({ lastFullAt: now, lastIncrementalAt: sessionStart, count: await countRows() });
  } else {
    // 0 páginas en total — no promovemos, conservamos el cache previo.
    const meta = await getMeta();
    await setMeta({ ...meta, lastFullAt: now });
  }
  await clearFullPivot();
  await clearFullActive();
  const lastResult: SyncLastResult = { kind: "full", upserted, deleted: 0, skipped, finishedAt: now };
  await patchStatus({ state: "idle", kind: null, startedAt: null, skipped, lastResult });
  return { ok: true, done: true, upserted, deleted: 0 };
}

async function runIncremental(): Promise<SyncResult> {
  const meta = await getMeta();
  const since = meta.lastIncrementalAt
    ? new Date(new Date(meta.lastIncrementalAt).getTime() - OVERLAP_MS).toISOString()
    : null;

  // FX-002: el corte de la ventana se captura ANTES del fetch. Lo que se edite mientras
  // este sync corre queda después de este instante y cae en la próxima ventana (más el
  // OVERLAP_MS, que además absorbe el redondeo al minuto del last_edited_time de Notion).
  const startedAt = new Date().toISOString();
  await setStatus({ state: "running", kind: "incremental", done: 0, total: 0, startedAt, error: null, skipped: 0 });

  let skipped = 0;
  const { pages, archivedIds } = await fetchPages({
    since,
    onProgress: async (done, total) => { await patchStatus({ done, total }); },
    shouldCancel: async () => await isCancelRequested(),
  });
  const batch: { id: string; row: Record<string, string> }[] = [];
  for (const p of pages) {
    try { batch.push({ id: p.id, row: flattenPage(p) }); }
    catch { skipped++; }
  }
  if (batch.length) await upsertRows(batch);
  if (archivedIds.length) await deleteRows(archivedIds);

  const cancelled = await isCancelRequested();
  const now = new Date().toISOString();
  // Cancelado: lo procesado se conserva pero la ventana NO avanza — el próximo
  // incremental re-trae lo que éste no alcanzó a ver (FX-002).
  await setMeta({
    ...meta,
    ...(cancelled ? {} : { lastIncrementalAt: startedAt }),
    count: await countRows(),
  });
  const lastResult: SyncLastResult = {
    kind: "incremental", upserted: batch.length, deleted: archivedIds.length, skipped, finishedAt: now,
  };
  await patchStatus({ state: "idle", kind: null, startedAt: null, skipped, lastResult });
  return { ok: true, done: true, upserted: batch.length, deleted: archivedIds.length };
}
