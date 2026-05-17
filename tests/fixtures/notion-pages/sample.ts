export function page(properties: Record<string, any>, opts: { id?: string; archived?: boolean; last_edited_time?: string } = {}) {
  return {
    object: "page",
    id: opts.id ?? "page-1",
    archived: opts.archived ?? false,
    last_edited_time: opts.last_edited_time ?? "2026-05-17T12:00:00.000Z",
    properties,
  };
}

export const titleProp = (text: string) => ({
  id: "p1", type: "title",
  title: text ? [{ plain_text: text, type: "text" }] : [],
});

export const richTextProp = (text: string) => ({
  id: "p2", type: "rich_text",
  rich_text: text ? [{ plain_text: text, type: "text" }] : [],
});

export const numberProp = (n: number | null) => ({ id: "p3", type: "number", number: n });
export const selectProp = (name: string | null) => ({ id: "p4", type: "select", select: name ? { name } : null });
export const multiSelectProp = (names: string[]) => ({ id: "p5", type: "multi_select", multi_select: names.map((name) => ({ name })) });
export const dateProp = (start: string | null, end: string | null = null) => ({
  id: "p6", type: "date", date: start ? { start, end } : null,
});
export const checkboxProp = (v: boolean) => ({ id: "p7", type: "checkbox", checkbox: v });
export const urlProp = (v: string | null) => ({ id: "p8", type: "url", url: v });
export const emailProp = (v: string | null) => ({ id: "p9", type: "email", email: v });
export const phoneProp = (v: string | null) => ({ id: "p10", type: "phone_number", phone_number: v });
export const peopleProp = (names: string[]) => ({
  id: "p11", type: "people",
  people: names.map((name) => ({ object: "user", id: `u-${name}`, name })),
});
export const relationProp = (ids: string[]) => ({
  id: "p12", type: "relation",
  relation: ids.map((id) => ({ id })),
});
export const formulaProp = (val: any) => ({ id: "p13", type: "formula", formula: val });
export const rollupProp = (val: any) => ({ id: "p14", type: "rollup", rollup: val });
export const filesProp = (urls: string[]) => ({
  id: "p15", type: "files",
  files: urls.map((url) => ({ name: url.split("/").pop(), type: "external", external: { url } })),
});
export const statusProp = (name: string | null) => ({ id: "p16", type: "status", status: name ? { name } : null });
