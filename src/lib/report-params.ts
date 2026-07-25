// src/lib/report-params.ts — parseo/validación de query params de /api/reports/*.
// Server-side estricto, mismo espíritu que la validación del export: nada del
// cliente llega al SQL sin validar (los valores van como parámetros, nunca
// interpolados, pero igual se rechaza lo malformado con 400).
import type { ReportFilters } from "@/lib/store-shared";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ParseResult =
  | { ok: true; filters: ReportFilters }
  | { ok: false; error: string };

/** Acepta claves repetidas (`person=A&person=B`) y también la forma `person[]=`. */
function getMulti(sp: URLSearchParams, key: string): string[] | undefined {
  const vals = [...sp.getAll(key), ...sp.getAll(`${key}[]`)].map((v) => v.trim()).filter(Boolean);
  return vals.length ? vals : undefined;
}

export function parseReportFilters(sp: URLSearchParams): ParseResult {
  // from/to son opcionales (ausente = sin cota); si vienen, deben ser ISO válidos.
  const from = sp.get("from");
  const to = sp.get("to");
  if (from && !ISO_DATE.test(from)) return { ok: false, error: "bad_from" };
  if (to && !ISO_DATE.test(to)) return { ok: false, error: "bad_to" };
  if (from && to && from > to) return { ok: false, error: "from_after_to" };
  return {
    ok: true,
    filters: {
      from: from || undefined,
      to: to || undefined,
      people: getMulti(sp, "person"),
      subprojects: getMulti(sp, "subproject"),
      projects: getMulti(sp, "project"),
      companies: getMulti(sp, "company"),
    },
  };
}

export function parseGranularity(sp: URLSearchParams): "month" | "week" | null {
  const g = sp.get("granularity") ?? "month";
  return g === "month" || g === "week" ? g : null;
}

export function parseLimit(sp: URLSearchParams): number | null {
  const raw = sp.get("limit");
  if (raw === null) return 50;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 200 ? n : null;
}
