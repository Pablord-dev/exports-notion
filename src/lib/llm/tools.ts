import { reportByPerson, reportBySubproject, reportTimeline, reportMatrix, reportDetail, reportFilters } from "@/lib/db";
import { parseReportFilters } from "@/lib/report-params";
import type { ReportFilters } from "@/lib/store-shared";
import type { ToolDef } from "./types";

// Bloque de propiedades de filtro reutilizado en varias tools.
const FILTER_PROPS = {
  from: { type: "string", description: "Fecha inicio inclusive YYYY-MM-DD (opcional)" },
  to: { type: "string", description: "Fecha fin inclusive YYYY-MM-DD (opcional)" },
  people: { type: "array", items: { type: "string" }, description: "IDs de persona (de listarFiltros.people[].value)" },
  subprojects: { type: "array", items: { type: "string" }, description: "Nombres de subproyecto" },
  projects: { type: "array", items: { type: "string" }, description: "Nombres de proyecto" },
  companies: { type: "array", items: { type: "string" }, description: "Nombres de empresa" },
} as const;

const filterObject = (extra: Record<string, unknown> = {}) => ({ type: "object", properties: { ...FILTER_PROPS, ...extra } });

export const TOOL_DEFS: ToolDef[] = [
  { name: "listarFiltros", description: "Lista los valores válidos de personas (con id y nombre), subproyectos, proyectos y empresas. Úsalo ANTES de filtrar por nombre.", parameters: { type: "object", properties: {} } },
  { name: "totalesPorPersona", description: "Horas y número de registros por persona dentro de los filtros.", parameters: filterObject() },
  { name: "totalesPorSubproyecto", description: "Horas y número de registros por subproyecto dentro de los filtros.", parameters: filterObject() },
  { name: "lineaDeTiempo", description: "Horas agregadas por semana o mes dentro de los filtros.", parameters: filterObject({ granularity: { type: "string", enum: ["week", "month"], description: "Agrupación temporal (default month)" } }) },
  { name: "matriz", description: "Matriz dimensión × semana. dim=subproject: filas por subproyecto (usar con 1 persona filtrada). dim=person: filas por persona (usar con 1 subproyecto).", parameters: filterObject({ dim: { type: "string", enum: ["person", "subproject"], description: "Dimensión de las filas" } }) },
  { name: "detalle", description: "Filas individuales (paginadas por cursor keyset) dentro de los filtros.", parameters: filterObject({ cursor: { type: "string", description: "Cursor de la página anterior (opcional)" }, limit: { type: "number", description: "1..200 (default 50)" } }) },
];

class ToolArgError extends Error {}

function buildFilters(args: Record<string, unknown>): ReportFilters {
  const sp = new URLSearchParams();
  if (typeof args.from === "string") sp.set("from", args.from);
  if (typeof args.to === "string") sp.set("to", args.to);
  for (const [k, key] of [["people", "person"], ["subprojects", "subproject"], ["projects", "project"], ["companies", "company"]] as const) {
    const v = args[k];
    if (Array.isArray(v)) for (const item of v) if (item != null) sp.append(key, String(item));
  }
  const r = parseReportFilters(sp);
  if (!r.ok) throw new ToolArgError(r.error);
  return r.filters;
}

export async function runTool(name: string, rawArgs: string): Promise<unknown> {
  let args: Record<string, unknown>;
  try {
    args = rawArgs && rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { error: "argumentos no son JSON válido" };
  }
  try {
    switch (name) {
      case "listarFiltros":
        return await reportFilters();
      case "totalesPorPersona":
        return await reportByPerson(buildFilters(args));
      case "totalesPorSubproyecto":
        return await reportBySubproject(buildFilters(args));
      case "lineaDeTiempo":
        return await reportTimeline(buildFilters(args), args.granularity === "week" ? "week" : "month");
      case "matriz": {
        if (args.dim !== "person" && args.dim !== "subproject") return { error: "dim debe ser 'person' o 'subproject'" };
        return await reportMatrix(buildFilters(args), args.dim);
      }
      case "detalle": {
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const cursor = typeof args.cursor === "string" ? args.cursor : null;
        return await reportDetail(buildFilters(args), cursor, limit);
      }
      default:
        return { error: `herramienta desconocida: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "error ejecutando la herramienta" };
  }
}
