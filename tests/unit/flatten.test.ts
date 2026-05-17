import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/columns", () => ({
  COLUMNS: [
    { notion: "Title", csv: "Nombre" },
    { notion: "Desc" },
    { notion: "Score" },
    { notion: "Status" },
    { notion: "Tags" },
    { notion: "When" },
    { notion: "Done" },
    { notion: "URL" },
    { notion: "Email" },
    { notion: "Phone" },
    { notion: "People" },
    { notion: "Related" },
    { notion: "Calc" },
    { notion: "Roll" },
    { notion: "Files" },
    { notion: "Stage" },
    { notion: "Missing" },
  ],
  csvHeaders: () => [],
}));

import { flattenPage } from "@/lib/flatten";
import {
  page, titleProp, richTextProp, numberProp, selectProp, multiSelectProp,
  dateProp, checkboxProp, urlProp, emailProp, phoneProp, peopleProp,
  relationProp, formulaProp, rollupProp, filesProp, statusProp,
} from "../fixtures/notion-pages/sample";

describe("flattenPage", () => {
  it("aplana title", () => {
    const row = flattenPage(page({ Title: titleProp("Hola") }) as any);
    expect(row.Nombre).toBe("Hola");
  });

  it("aplana rich_text", () => {
    const row = flattenPage(page({ Desc: richTextProp("Mundo") }) as any);
    expect(row.Desc).toBe("Mundo");
  });

  it("number a string (incluye 0)", () => {
    expect(flattenPage(page({ Score: numberProp(0) }) as any).Score).toBe("0");
    expect(flattenPage(page({ Score: numberProp(null) }) as any).Score).toBe("");
  });

  it("select y multi_select", () => {
    expect(flattenPage(page({ Status: selectProp("Activo") }) as any).Status).toBe("Activo");
    expect(flattenPage(page({ Tags: multiSelectProp(["a","b","c"]) }) as any).Tags).toBe("a, b, c");
    expect(flattenPage(page({ Tags: multiSelectProp([]) }) as any).Tags).toBe("");
  });

  it("date: solo start vs start+end", () => {
    expect(flattenPage(page({ When: dateProp("2026-05-01") }) as any).When).toBe("2026-05-01");
    expect(flattenPage(page({ When: dateProp("2026-05-01","2026-05-10") }) as any).When).toBe("2026-05-01 → 2026-05-10");
    expect(flattenPage(page({ When: dateProp(null) }) as any).When).toBe("");
  });

  it("checkbox / url / email / phone", () => {
    expect(flattenPage(page({ Done: checkboxProp(true) }) as any).Done).toBe("true");
    expect(flattenPage(page({ URL: urlProp("https://x") }) as any).URL).toBe("https://x");
    expect(flattenPage(page({ Email: emailProp("a@b.c") }) as any).Email).toBe("a@b.c");
    expect(flattenPage(page({ Phone: phoneProp("+52 55") }) as any).Phone).toBe("+52 55");
  });

  it("people y relation con join por coma", () => {
    expect(flattenPage(page({ People: peopleProp(["Ana","Bob"]) }) as any).People).toBe("Ana, Bob");
    expect(flattenPage(page({ Related: relationProp(["abc","def"]) }) as any).Related).toBe("abc, def");
  });

  it("formula y rollup: resuelve por tipo interno", () => {
    const f = page({ Calc: formulaProp({ type: "string", string: "hi" }) }) as any;
    expect(flattenPage(f).Calc).toBe("hi");
    const f2 = page({ Calc: formulaProp({ type: "number", number: 42 }) }) as any;
    expect(flattenPage(f2).Calc).toBe("42");
    const r = page({ Roll: rollupProp({ type: "array", array: [{ type: "number", number: 1 }, { type: "number", number: 2 }] }) }) as any;
    expect(flattenPage(r).Roll).toBe("1, 2");
  });

  it("files: lista urls separadas por coma", () => {
    const f = page({ Files: filesProp(["https://x/a.png","https://x/b.png"]) }) as any;
    expect(flattenPage(f).Files).toBe("https://x/a.png, https://x/b.png");
  });

  it("status type", () => {
    expect(flattenPage(page({ Stage: statusProp("Hecho") }) as any).Stage).toBe("Hecho");
    expect(flattenPage(page({ Stage: statusProp(null) }) as any).Stage).toBe("");
  });

  it("propiedad whitelisted ausente queda vacía", () => {
    const row = flattenPage(page({}) as any);
    expect(row.Missing).toBe("");
  });

  it("ignora propiedades NO whitelisted", () => {
    const row = flattenPage(page({ Hidden: titleProp("secret"), Title: titleProp("Hola") }) as any);
    expect(row.Nombre).toBe("Hola");
    expect((row as any).Hidden).toBeUndefined();
  });
});
