// src/lib/notion.ts
import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client";

const PAGE_SIZE = 100;
const REQS_PER_SECOND = 3;

let _client: Client | null = null;
function client(): Client {
  if (!_client) _client = new Client({ auth: process.env.NOTION_TOKEN! });
  return _client;
}
export function __setClient(c: Client | null) {
  _client = c;
}

class Throttle {
  private last = 0;
  async wait() {
    const minGap = 1000 / REQS_PER_SECOND;
    const now = Date.now();
    const wait = Math.max(0, this.last + minGap - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }
}

export interface FetchOptions {
  /** ISO date string. Si está presente, se filtra por last_edited_time > since. */
  since?: string | null;
  /** Callback con (procesados, totalConocido). */
  onProgress?: (done: number, total: number) => void | Promise<void>;
  /** Si devuelve true, se aborta la paginación. Lo procesado hasta el momento se conserva. */
  shouldCancel?: () => boolean | Promise<boolean>;
}

export interface FetchResult {
  pages: PageObjectResponse[];
  /** Páginas archivadas detectadas (vienen con archived: true). */
  archivedIds: string[];
  /** Sólo relevante en modo full: si el segmento llenó 10k, created_time del último page para reanudar. null si no hay más. */
  nextPivot?: string | null;
}

export interface FullSegmentOptions {
  /** created_time desde el cual reanudar (DESC + on_or_before). undefined = primer segmento. */
  pivot?: string;
  /** Presupuesto de tiempo en ms para esta llamada. Default 25s (cabe en los 60s de Hobby con margen). */
  timeBudgetMs?: number;
  onProgress?: FetchOptions["onProgress"];
  shouldCancel?: FetchOptions["shouldCancel"];
}

// Notion API limita CUALQUIER query a 10,000 resultados (incluso paginando con cursor).
// Para datasets más grandes, full sync se segmenta por `created_time` DESC, usando el
// created_time del último page del segmento como pivote del siguiente (filter on_or_before).
// Dedupe vía seenIds (y el cache es HSET por page.id, así que duplicados se sobrescriben).
const NOTION_QUERY_CAP = 10_000;

export async function fetchPages(opts: FetchOptions = {}): Promise<FetchResult> {
  // NOTE: In @notionhq/client v5.x the `databases.query` endpoint was replaced by
  // `dataSources.query`. We keep the existing `NOTION_DATABASE_ID` env var name for
  // backward compatibility, but it must contain a Notion *data source* ID.
  const dataSourceId = process.env.NOTION_DATABASE_ID!;
  const throttle = new Throttle();
  const pages: PageObjectResponse[] = [];
  const archivedIds: string[] = [];
  const seenIds = new Set<string>();

  // Incremental: un solo segmento filtrado por last_edited_time.
  if (opts.since) {
    const filter = {
      timestamp: "last_edited_time" as const,
      last_edited_time: { after: opts.since },
    };
    await fetchSegment({ dataSourceId, throttle, filter, pages, archivedIds, seenIds, onProgress: opts.onProgress, shouldCancel: opts.shouldCancel });
    return { pages, archivedIds };
  }

  // Full: segmentos DESC por created_time con pivote para superar el cap de 10k.
  let pivot: string | undefined;
  while (true) {
    if (await opts.shouldCancel?.()) break;
    const filter = pivot
      ? { timestamp: "created_time" as const, created_time: { on_or_before: pivot } }
      : undefined;
    const sorts = [{ timestamp: "created_time" as const, direction: "descending" as const }];
    const beforeCount = pages.length + archivedIds.length;
    const lastCreatedTime = await fetchSegment({
      dataSourceId, throttle, filter, sorts, pages, archivedIds, seenIds, onProgress: opts.onProgress, shouldCancel: opts.shouldCancel,
    });
    const segmentCount = pages.length + archivedIds.length - beforeCount;
    if (segmentCount < NOTION_QUERY_CAP || !lastCreatedTime) break;
    if (lastCreatedTime === pivot) break; // anti-loop si todos los registros comparten timestamp
    if (await opts.shouldCancel?.()) break;
    pivot = lastCreatedTime;
  }
  return { pages, archivedIds };
}

/**
 * Procesa un segmento del full sync con presupuesto de tiempo.
 * - Pagina DESC por created_time, con filtro `on_or_before: pivot` si hay pivot.
 * - Se detiene en: cancelación, presupuesto de tiempo agotado, o Notion responde `has_more=false`.
 * - Devuelve `nextPivot=null` SOLO cuando Notion confirma `has_more=false` y el conteo no llegó al cap de 10k (= no hay más records). En cualquier otro caso devuelve el `created_time` del último page para reanudar.
 */
export async function fetchOneFullSegment(opts: FullSegmentOptions = {}): Promise<FetchResult> {
  const dataSourceId = process.env.NOTION_DATABASE_ID!;
  const TIME_BUDGET_MS = opts.timeBudgetMs ?? 25_000;
  const throttle = new Throttle();
  const pages: PageObjectResponse[] = [];
  const archivedIds: string[] = [];
  const seenIds = new Set<string>();

  const filter = opts.pivot
    ? { timestamp: "created_time" as const, created_time: { on_or_before: opts.pivot } }
    : undefined;
  const sorts = [{ timestamp: "created_time" as const, direction: "descending" as const }];

  const startTime = Date.now();
  let cursor: string | undefined = undefined;
  let lastCreatedTime: string | undefined;
  let exhausted = false;

  do {
    if (await opts.shouldCancel?.()) break;
    if (Date.now() - startTime > TIME_BUDGET_MS) break;
    await throttle.wait();
    const resp = await retry(() =>
      client().dataSources.query({
        data_source_id: dataSourceId,
        start_cursor: cursor,
        page_size: PAGE_SIZE,
        ...(filter ? { filter } : {}),
        sorts,
      }),
    );
    for (const r of resp.results) {
      if (!isFullPage(r)) continue;
      lastCreatedTime = r.created_time;
      if (seenIds.has(r.id)) continue;
      seenIds.add(r.id);
      if (r.archived) archivedIds.push(r.id);
      else pages.push(r);
    }
    const done = pages.length + archivedIds.length;
    await opts.onProgress?.(done, done + (resp.has_more ? PAGE_SIZE : 0));
    if (resp.has_more) {
      cursor = resp.next_cursor ?? undefined;
    } else {
      exhausted = true;
      cursor = undefined;
    }
  } while (cursor);

  const segmentCount = pages.length + archivedIds.length;
  const cancelled = await opts.shouldCancel?.();
  // "Realmente terminamos" sólo si Notion confirmó has_more=false Y no rozamos el cap de 10k
  // (si rozamos el cap, hay más records con created_time < lastCreatedTime).
  const isDone = exhausted && segmentCount < NOTION_QUERY_CAP && !cancelled;
  // Anti-loop: si tras un segmento completo el lastCreatedTime es igual al pivot anterior,
  // no hicimos progreso (todos los records compartían timestamp). Marcar como done.
  const nextPivot =
    !isDone && lastCreatedTime && lastCreatedTime !== opts.pivot ? lastCreatedTime : null;
  return { pages, archivedIds, nextPivot };
}

interface SegmentArgs {
  dataSourceId: string;
  throttle: Throttle;
  filter?: any;
  sorts?: any[];
  pages: PageObjectResponse[];
  archivedIds: string[];
  seenIds: Set<string>;
  onProgress?: FetchOptions["onProgress"];
  shouldCancel?: FetchOptions["shouldCancel"];
}

/** Pagina un segmento hasta agotar el cursor. Devuelve el created_time del último page visto. */
async function fetchSegment(a: SegmentArgs): Promise<string | undefined> {
  let cursor: string | undefined = undefined;
  let lastCreatedTime: string | undefined;
  do {
    if (await a.shouldCancel?.()) break;
    await a.throttle.wait();
    const resp = await retry(() =>
      client().dataSources.query({
        data_source_id: a.dataSourceId,
        start_cursor: cursor,
        page_size: PAGE_SIZE,
        ...(a.filter ? { filter: a.filter } : {}),
        ...(a.sorts ? { sorts: a.sorts } : {}),
      }),
    );
    for (const r of resp.results) {
      if (!isFullPage(r)) continue;
      lastCreatedTime = r.created_time;
      if (a.seenIds.has(r.id)) continue;
      a.seenIds.add(r.id);
      if (r.archived) a.archivedIds.push(r.id);
      else a.pages.push(r);
    }
    const done = a.pages.length + a.archivedIds.length;
    await a.onProgress?.(done, done + (resp.has_more ? PAGE_SIZE : 0));
    cursor = resp.has_more ? resp.next_cursor ?? undefined : undefined;
  } while (cursor);
  return lastCreatedTime;
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const code = e?.status ?? e?.code;
      if (code === 401 || code === 404) throw e;
      // 429 con Retry-After
      const retryAfter = Number(e?.headers?.["retry-after"] ?? 0);
      const backoff = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** i;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
