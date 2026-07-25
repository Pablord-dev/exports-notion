import { describe, it, expect, beforeEach } from "vitest";
import * as db from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";
import { runTool, TOOL_DEFS } from "@/lib/llm/tools";
import { REPORT_SEED } from "../fixtures/reportCases";

beforeEach(async () => {
  db.__setStore(newMemoryStore());
  await db.upsertRows(REPORT_SEED);
});

describe("llm tools", () => {
  it("expone 6 herramientas con schema de objeto", () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual(
      ["detalle", "lineaDeTiempo", "listarFiltros", "matriz", "totalesPorPersona", "totalesPorSubproyecto"],
    );
    for (const t of TOOL_DEFS) expect(t.parameters).toMatchObject({ type: "object" });
  });

  it("totalesPorPersona corre el reporte con filtros", async () => {
    const r = await runTool("totalesPorPersona", JSON.stringify({ from: "2026-06-01", to: "2026-06-30" }));
    expect(r).toEqual([
      { person: "u-beto", label: "Beto", hours: 4, count: 2 },
      { person: "u-ana", label: "Ana", hours: 3.5, count: 2 },
    ]);
  });

  it("lineaDeTiempo respeta la granularidad", async () => {
    const r = await runTool("lineaDeTiempo", JSON.stringify({ from: "2026-06-01", to: "2026-06-30", granularity: "week" }));
    expect(r).toEqual([
      { bucket: "2026-06-01", hours: 4.5, count: 3 },
      { bucket: "2026-06-08", hours: 3, count: 1 },
    ]);
  });

  it("matriz valida dim", async () => {
    expect(await runTool("matriz", JSON.stringify({ dim: "bad" }))).toMatchObject({ error: expect.stringContaining("dim") });
  });

  it("fechas malformadas → error legible, no excepción", async () => {
    expect(await runTool("totalesPorPersona", JSON.stringify({ from: "ayer" }))).toMatchObject({ error: "bad_from" });
  });

  it("args no-JSON → error", async () => {
    expect(await runTool("totalesPorPersona", "{no json")).toMatchObject({ error: expect.any(String) });
  });

  it("herramienta desconocida → error", async () => {
    expect(await runTool("inexistente", "{}")).toMatchObject({ error: expect.stringContaining("desconocida") });
  });

  it("listarFiltros devuelve el catálogo", async () => {
    const r = (await runTool("listarFiltros", "{}")) as { people: unknown[]; subprojects: string[] };
    expect(r.subprojects).toContain("Alpha");
    expect(Array.isArray(r.people)).toBe(true);
  });
});
