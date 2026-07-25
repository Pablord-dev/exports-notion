import { describe, it, expect } from "vitest";
import { parseReportFilters, parseGranularity, parseLimit } from "@/lib/report-params";

const sp = (q: string) => new URLSearchParams(q);

describe("parseReportFilters", () => {
  it("acepta rango ausente (= todos los registros) y cotas sueltas", () => {
    expect(parseReportFilters(sp(""))).toMatchObject({ ok: true, filters: { from: undefined, to: undefined } });
    expect(parseReportFilters(sp("from=2026-06-01"))).toMatchObject({ ok: true, filters: { from: "2026-06-01", to: undefined } });
    expect(parseReportFilters(sp("to=2026-06-30"))).toMatchObject({ ok: true, filters: { from: undefined, to: "2026-06-30" } });
  });

  it("valida ISO y from <= to cuando las cotas sí vienen", () => {
    expect(parseReportFilters(sp("from=junio&to=2026-06-30"))).toMatchObject({ ok: false, error: "bad_from" });
    expect(parseReportFilters(sp("from=2026-06-01&to=treinta"))).toMatchObject({ ok: false, error: "bad_to" });
    expect(parseReportFilters(sp("from=2026-07-01&to=2026-06-30"))).toMatchObject({ ok: false, error: "from_after_to" });
  });

  it("acepta filtros repetidos y la forma con corchetes", () => {
    const r = parseReportFilters(sp("from=2026-06-01&to=2026-06-30&person=Ana&person=Beto&subproject[]=Alpha&company=ACME"));
    expect(r).toEqual({
      ok: true,
      filters: {
        from: "2026-06-01", to: "2026-06-30",
        people: ["Ana", "Beto"], subprojects: ["Alpha"], projects: undefined, companies: ["ACME"],
      },
    });
  });

  it("descarta valores vacíos o de puro espacio", () => {
    const r = parseReportFilters(sp("from=2026-06-01&to=2026-06-30&person=%20%20&project="));
    expect(r.ok && r.filters.people).toBeUndefined();
    expect(r.ok && r.filters.projects).toBeUndefined();
  });
});

describe("parseGranularity", () => {
  it("default month; sólo month|week", () => {
    expect(parseGranularity(sp(""))).toBe("month");
    expect(parseGranularity(sp("granularity=week"))).toBe("week");
    expect(parseGranularity(sp("granularity=day"))).toBeNull();
  });
});

describe("parseLimit", () => {
  it("default 50; rechaza fuera de 1..200 o no enteros", () => {
    expect(parseLimit(sp(""))).toBe(50);
    expect(parseLimit(sp("limit=200"))).toBe(200);
    expect(parseLimit(sp("limit=0"))).toBeNull();
    expect(parseLimit(sp("limit=201"))).toBeNull();
    expect(parseLimit(sp("limit=abc"))).toBeNull();
  });
});
