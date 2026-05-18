import { page, titleProp, dateProp } from "./notion-pages/sample";

export function makeFakeClient(initialPages: any[]) {
  return {
    dataSources: {
      async query(args: any) {
        const cursor = Number(args.start_cursor ?? 0);
        const slice = initialPages.slice(cursor, cursor + args.page_size);
        const next = cursor + slice.length;
        return {
          results: slice,
          has_more: next < initialPages.length,
          next_cursor: next < initialPages.length ? String(next) : null,
        };
      },
    },
  } as any;
}

export function makePage(id: string, title: string, when: string, archived = false) {
  // `isFullPage` from @notionhq/client v5 requires `object === "page"` and a `url` field.
  // The shared `page()` helper omits `url`, so we add it here.
  const p: any = page({ Title: titleProp(title), When: dateProp(when) }, { id, archived });
  p.url = `https://www.notion.so/${id}`;
  return p;
}
