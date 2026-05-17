import { describe, it, expect } from "vitest";
import { filterByDateRange } from "@/lib/filter";

const rows = [
  { id: "1", When: "2026-01-15" },
  { id: "2", When: "2026-05-01" },
  { id: "3", When: "2026-05-17" },
  { id: "4", When: "" },
  { id: "5", When: "no-es-fecha" },
  { id: "6", When: "2026-05-10 → 2026-05-20" },
];

describe("filterByDateRange", () => {
  it("incluye bordes (from y to inclusive)", () => {
    const r = filterByDateRange(rows, "2026-05-01", "2026-05-17", "When");
    expect(r.map((x) => x.id)).toEqual(["2", "3", "6"]);
  });
  it("sin from", () => {
    const r = filterByDateRange(rows, null, "2026-05-01", "When");
    expect(r.map((x) => x.id)).toEqual(["1", "2"]);
  });
  it("sin to", () => {
    const r = filterByDateRange(rows, "2026-05-10", null, "When");
    expect(r.map((x) => x.id)).toEqual(["3", "6"]);
  });
  it("sin from ni to: devuelve todo (incluso null/basura)", () => {
    expect(filterByDateRange(rows, null, null, "When")).toHaveLength(6);
  });
  it("filas con fecha vacía o inválida se excluyen cuando hay filtro", () => {
    const r = filterByDateRange(rows, "2026-01-01", "2026-12-31", "When");
    expect(r.map((x) => x.id)).toEqual(["1", "2", "3", "6"]);
  });
});
