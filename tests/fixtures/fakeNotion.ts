import { page, titleProp, dateProp } from "./notion-pages/sample";

export interface FakeClientOptions {
  /** Hook invocado al inicio de cada query (p. ej. para disparar un cancel mid-run o medir tiempos). */
  onQuery?: (args: any) => void | Promise<void>;
}

/** Reproduce el `validation_error` real del API cuando el body trae un campo no soportado. */
function throwValidation(field: string): never {
  throw Object.assign(
    new Error(`body failed validation: body.${field} should be not present, instead was \`true\`.`),
    { status: 400, code: "validation_error" },
  );
}

/**
 * Fake de `@notionhq/client` fiel al comportamiento real del API (Notion-Version 2025-09-03):
 * - `in_trash` y `archived` NO existen en el body de data_sources/query → validation_error 400
 *   (regresión del 2026-07-06: el SDK los tipa pero el servidor los rechaza).
 * - `is_archived` PARTICIONA: true = SOLO papelera; omitido/false = SOLO vivas.
 *   (No es un flag de "incluir": la doc es explícita.)
 * - Aplica el filtro de timestamp `last_edited_time.after` (modo incremental).
 * - Aplica el filtro `created_time.on_or_before` y el sort DESC (segmentos del full).
 * - Expone `request()` crudo además de `dataSources.query` porque el SDK descarta
 *   `is_archived` de su whitelist interna y el código real usa `request()` para la papelera.
 */
export function makeFakeClient(initialPages: any[], opts: FakeClientOptions = {}) {
  const calls: { args: any; at: number }[] = [];

  async function runQuery(args: any) {
    calls.push({ args, at: Date.now() });
    await opts.onQuery?.(args);

    if ("in_trash" in args) throwValidation("in_trash");
    if ("archived" in args) throwValidation("archived");

    let universe = initialPages.filter((p) => Boolean(p.archived) === Boolean(args.is_archived));
    if (args.filter?.timestamp === "last_edited_time" && args.filter.last_edited_time?.after) {
      const t = new Date(args.filter.last_edited_time.after).getTime();
      universe = universe.filter((p) => new Date(p.last_edited_time).getTime() > t);
    }
    if (args.filter?.timestamp === "created_time" && args.filter.created_time?.on_or_before) {
      const t = new Date(args.filter.created_time.on_or_before).getTime();
      universe = universe.filter((p) => new Date(p.created_time).getTime() <= t);
    }
    if (args.sorts?.some((s: any) => s.timestamp === "created_time" && s.direction === "descending")) {
      universe = [...universe].sort(
        (a, b) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime(),
      );
    }

    const cursor = Number(args.start_cursor ?? 0);
    const slice = universe.slice(cursor, cursor + args.page_size);
    const next = cursor + args.page_size;
    return {
      results: slice,
      has_more: next < universe.length,
      next_cursor: next < universe.length ? String(next) : null,
    };
  }

  return {
    __calls: calls,
    dataSources: {
      query: (args: any) => runQuery(args),
    },
    request: ({ path, method, body }: { path: string; method: string; body?: any }) => {
      if (method !== "post" || !/^data_sources\/.+\/query$/.test(path)) {
        throw new Error(`fake: unsupported request ${method} ${path}`);
      }
      return runQuery(body ?? {});
    },
  } as any;
}

export function makePage(
  id: string,
  title: string,
  when: string,
  archived = false,
  extra: { created_time?: string; last_edited_time?: string } = {},
) {
  // `isFullPage` from @notionhq/client v5 requires `object === "page"` and a `url` field.
  // The shared `page()` helper omits `url`, so we add it here.
  const p: any = page({ Title: titleProp(title), When: dateProp(when) }, { id, archived });
  p.url = `https://www.notion.so/${id}`;
  p.created_time = extra.created_time ?? "2026-01-01T00:00:00.000Z";
  if (extra.last_edited_time) p.last_edited_time = extra.last_edited_time;
  return p;
}
