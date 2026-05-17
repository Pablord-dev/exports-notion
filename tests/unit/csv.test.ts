import { describe, it, expect } from "vitest";
import { rowsToCSVString } from "@/lib/csv";

describe("rowsToCSVString", () => {
  it("escribe headers y filas, escape de comas/comillas/saltos", async () => {
    const csv = await rowsToCSVString(
      ["a", "b"],
      [{ a: "hola", b: "x,y" }, { a: 'con "comillas"', b: "linea1\nlinea2" }],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const body = csv.slice(1);
    expect(body.split("\n")[0]).toBe("a,b");
    expect(body).toContain('"x,y"');
    expect(body).toContain('"con ""comillas"""');
    expect(body).toContain('"linea1\nlinea2"');
  });

  it("emite solo headers cuando no hay filas", async () => {
    const csv = await rowsToCSVString(["a", "b"], []);
    expect(csv.slice(1)).toBe("a,b\n");
  });

  it("respeta el orden de headers", async () => {
    const csv = await rowsToCSVString(["b", "a"], [{ a: "1", b: "2" }]);
    expect(csv.slice(1).split("\n")[1]).toBe("2,1");
  });
});
