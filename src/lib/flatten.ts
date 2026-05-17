import { COLUMNS } from "@/lib/columns";
import type { FlatRow } from "@/lib/types";

type AnyProp = Record<string, any>;

function richTextToString(arr: any[] | undefined): string {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  return arr.map((r) => r.plain_text ?? "").join("");
}

function dateToString(d: any): string {
  if (!d) return "";
  if (d.end) return `${d.start} → ${d.end}`;
  return d.start ?? "";
}

function formulaToString(f: any): string {
  if (!f) return "";
  switch (f.type) {
    case "string":  return f.string ?? "";
    case "number":  return f.number == null ? "" : String(f.number);
    case "boolean": return String(f.boolean);
    case "date":    return dateToString(f.date);
    default:        return "";
  }
}

function rollupToString(r: any): string {
  if (!r) return "";
  if (r.type === "number")  return r.number == null ? "" : String(r.number);
  if (r.type === "date")    return dateToString(r.date);
  if (r.type === "string")  return r.string ?? "";
  if (r.type === "array")   return (r.array ?? []).map(propValueToString).join(", ");
  return "";
}

function propValueToString(prop: AnyProp): string {
  if (!prop || !prop.type) return "";
  switch (prop.type) {
    case "title":         return richTextToString(prop.title);
    case "rich_text":     return richTextToString(prop.rich_text);
    case "number":        return prop.number == null ? "" : String(prop.number);
    case "select":        return prop.select?.name ?? "";
    case "status":        return prop.status?.name ?? "";
    case "multi_select":  return (prop.multi_select ?? []).map((s: any) => s.name).join(", ");
    case "date":          return dateToString(prop.date);
    case "checkbox":      return String(Boolean(prop.checkbox));
    case "url":           return prop.url ?? "";
    case "email":         return prop.email ?? "";
    case "phone_number":  return prop.phone_number ?? "";
    case "people":        return (prop.people ?? []).map((p: any) => p.name ?? p.id).join(", ");
    case "relation":      return (prop.relation ?? []).map((r: any) => r.id).join(", ");
    case "files":         return (prop.files ?? []).map((f: any) => f.external?.url ?? f.file?.url ?? "").filter(Boolean).join(", ");
    case "formula":       return formulaToString(prop.formula);
    case "rollup":        return rollupToString(prop.rollup);
    case "created_time":  return prop.created_time ?? "";
    case "last_edited_time": return prop.last_edited_time ?? "";
    default:              return "";
  }
}

export function flattenPage(page: { properties: Record<string, AnyProp> }): FlatRow {
  const out: FlatRow = {};
  for (const col of COLUMNS) {
    const key = col.csv ?? col.notion;
    const prop = page.properties[col.notion];
    out[key] = prop ? propValueToString(prop) : "";
  }
  return out;
}
