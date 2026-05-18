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
}

export interface FetchResult {
  pages: PageObjectResponse[];
  /** Páginas archivadas detectadas (vienen con archived: true). */
  archivedIds: string[];
}

export async function fetchPages(opts: FetchOptions = {}): Promise<FetchResult> {
  // NOTE: In @notionhq/client v5.x the `databases.query` endpoint was replaced by
  // `dataSources.query`. We keep the existing `NOTION_DATABASE_ID` env var name for
  // backward compatibility, but it must contain a Notion *data source* ID.
  const dataSourceId = process.env.NOTION_DATABASE_ID!;
  const throttle = new Throttle();
  const pages: PageObjectResponse[] = [];
  const archivedIds: string[] = [];
  let cursor: string | undefined = undefined;
  let done = 0;

  const filter = opts.since
    ? {
        timestamp: "last_edited_time" as const,
        last_edited_time: { after: opts.since },
      }
    : undefined;

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
      if (!isFullPage(r)) continue;
      if (r.archived) archivedIds.push(r.id);
      else pages.push(r);
    }
    done = pages.length + archivedIds.length;
    await opts.onProgress?.(done, done + (resp.has_more ? PAGE_SIZE : 0));
    cursor = resp.has_more ? resp.next_cursor ?? undefined : undefined;
  } while (cursor);

  return { pages, archivedIds };
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
