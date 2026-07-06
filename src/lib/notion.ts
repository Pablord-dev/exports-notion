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
}

// Notion API limita CUALQUIER query a 10,000 resultados (incluso paginando con cursor).
// Para datasets más grandes, full sync se segmenta por `created_time` DESC, usando el
// created_time del último page del segmento como pivote del siguiente (filter on_or_before).
// El cache es HSET por page.id, así que el solape entre segmentos se sobrescribe idempotente.
const NOTION_QUERY_CAP = 10_000;

// Respuesta mínima que necesitamos de la query cruda de papelera.
interface RawQueryResponse {
  results: Array<{ object: string; id: string; archived?: boolean }>;
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * Fetch incremental: DOS queries filtradas por last_edited_time (FX-001).
 * En el API real (Notion-Version 2025-09-03) `is_archived` PARTICIONA los resultados:
 * omitido/false = sólo vivas; true = sólo papelera. NO existe un flag para "incluir
 * ambas" (`in_trash`/`archived` en el body → validation_error 400, verificado
 * empíricamente el 2026-07-06). Por eso: query 1 = vivas (upsert), query 2 = papelera
 * (ids a borrar). La query 2 va por `client().request()` crudo porque el SDK v5.21
 * descarta `is_archived` de su whitelist interna de body params y lo perdería en silencio.
 */
export async function fetchPages(opts: FetchOptions = {}): Promise<FetchResult> {
  // NOTE: In @notionhq/client v5.x the `databases.query` endpoint was replaced by
  // `dataSources.query`. We keep the existing `NOTION_DATABASE_ID` env var name for
  // backward compatibility, but it must contain a Notion *data source* ID.
  const dataSourceId = process.env.NOTION_DATABASE_ID!;
  const throttle = new Throttle();
  const pages: PageObjectResponse[] = [];
  const archivedIds: string[] = [];

  const filter = opts.since
    ? { timestamp: "last_edited_time" as const, last_edited_time: { after: opts.since } }
    : undefined;

  const progress = async (hasMore: boolean) => {
    const done = pages.length + archivedIds.length;
    await opts.onProgress?.(done, done + (hasMore ? PAGE_SIZE : 0));
  };

  // 1) Vivas editadas en la ventana → upsert.
  let cursor: string | undefined = undefined;
  do {
    await throttle.wait();
    const resp = await retry(() =>
      client().dataSources.query({
        data_source_id: dataSourceId,
        start_cursor: cursor,
        page_size: PAGE_SIZE,
        ...(filter ? { filter } : {}),
      }),
    );
    for (const r of resp.results) {
      if (isFullPage(r)) pages.push(r);
    }
    cursor = resp.has_more ? resp.next_cursor ?? undefined : undefined;
    await progress(Boolean(cursor));
    if (cursor && (await opts.shouldCancel?.())) break;
  } while (cursor);

  // 2) Papelera editada en la ventana → ids a borrar del cache.
  if (!(await opts.shouldCancel?.())) {
    cursor = undefined;
    do {
      await throttle.wait();
      const resp = (await retry(() =>
        client().request({
          path: `data_sources/${dataSourceId}/query`,
          method: "post",
          body: {
            page_size: PAGE_SIZE,
            is_archived: true,
            ...(cursor ? { start_cursor: cursor } : {}),
            ...(filter ? { filter } : {}),
          },
        }),
      )) as RawQueryResponse;
      for (const r of resp.results) {
        if (r.object === "page") archivedIds.push(r.id);
      }
      cursor = resp.has_more ? resp.next_cursor ?? undefined : undefined;
      await progress(Boolean(cursor));
      if (cursor && (await opts.shouldCancel?.())) break;
    } while (cursor);
  }

  return { pages, archivedIds };
}

export interface FullBatchesOptions {
  /** created_time desde el cual reanudar (DESC + on_or_before). undefined = desde el inicio. */
  pivot?: string;
  /**
   * Invocado tras CADA página de cursor (≤100 registros) con el created_time del último
   * page visto y si el segmento tiene más resultados. Aquí el caller persiste el batch
   * y fija su checkpoint — si la función muere después, no se pierde este avance.
   */
  onBatch: (pages: PageObjectResponse[], lastCreatedTime: string | undefined, hasMore: boolean) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
  /** Evaluado tras cada batch: true = cortar la corrida (presupuesto de tiempo agotado). */
  budgetExhausted?: () => boolean;
}

export interface FullBatchesResult {
  /** true si se agotó el dataset; false si se cortó por cancel o presupuesto. */
  completed: boolean;
  cancelled: boolean;
}

/**
 * Fetch del full sync entregando batch por batch. Encadena internamente los segmentos
 * del cap de 10k (query nueva con pivote on_or_before) hasta agotar el dataset, salvo
 * que `shouldCancel` o `budgetExhausted` corten antes. La papelera queda fuera por
 * defecto (sin `in_trash`), que es exactamente lo que un snapshot completo necesita.
 */
export async function fetchFullBatches(opts: FullBatchesOptions): Promise<FullBatchesResult> {
  const dataSourceId = process.env.NOTION_DATABASE_ID!;
  const throttle = new Throttle();
  const sorts = [{ timestamp: "created_time" as const, direction: "descending" as const }];
  let pivot = opts.pivot;

  // Cada iteración externa = una query (un "segmento") que la API capa a 10k resultados.
  while (true) {
    let cursor: string | undefined = undefined;
    let segmentCount = 0;
    let lastCreatedTime: string | undefined;
    do {
      await throttle.wait();
      const resp = await retry(() =>
        client().dataSources.query({
          data_source_id: dataSourceId,
          start_cursor: cursor,
          page_size: PAGE_SIZE,
          ...(pivot ? { filter: { timestamp: "created_time" as const, created_time: { on_or_before: pivot } } } : {}),
          sorts,
        }),
      );
      const batch: PageObjectResponse[] = [];
      for (const r of resp.results) {
        if (!isFullPage(r)) continue;
        lastCreatedTime = r.created_time;
        segmentCount++;
        batch.push(r);
      }
      cursor = resp.has_more ? resp.next_cursor ?? undefined : undefined;
      await opts.onBatch(batch, lastCreatedTime, Boolean(cursor));
      if (!cursor) break; // segmento agotado — abajo se decide si el dataset terminó
      if (await opts.shouldCancel?.()) return { completed: false, cancelled: true };
      if (opts.budgetExhausted?.()) return { completed: false, cancelled: false };
    } while (true);

    // Segmento agotado sin rozar el cap → no quedan registros más antiguos.
    if (segmentCount < NOTION_QUERY_CAP || !lastCreatedTime) return { completed: true, cancelled: false };
    if (lastCreatedTime === pivot) return { completed: true, cancelled: false }; // anti-loop: timestamps idénticos
    pivot = lastCreatedTime;
    if (await opts.shouldCancel?.()) return { completed: false, cancelled: true };
    if (opts.budgetExhausted?.()) return { completed: false, cancelled: false };
  }
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const code = e?.status ?? e?.code;
      // 400 (validation), 401 y 404 son errores permanentes: reintentar sólo quema tiempo.
      if (code === 400 || code === 401 || code === 404) throw e;
      // 429 con Retry-After
      const retryAfter = Number(e?.headers?.["retry-after"] ?? 0);
      const backoff = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** i;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
