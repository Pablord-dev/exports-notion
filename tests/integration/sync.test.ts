import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/columns", () => ({
  COLUMNS: [{ notion: "Title", csv: "Nombre" }, { notion: "When" }],
  csvHeaders: () => ["Nombre", "When"],
}));

import { FakeRedis } from "../fixtures/fakeRedis";
import { makeFakeClient, makePage } from "../fixtures/fakeNotion";
import { __setClient as setRedis } from "@/lib/cache";
import { __setClient as setNotion } from "@/lib/notion";
import { runSync } from "@/lib/sync";
import * as cache from "@/lib/cache";

beforeEach(() => {
  process.env.NOTION_DATABASE_ID = "db-test";
  process.env.NOTION_TOKEN = "tok";
  setRedis(new FakeRedis() as any);
});

describe("runSync full", () => {
  it("escribe en cache nuevo, promueve atómico, actualiza meta", async () => {
    const pages = [
      makePage("a", "A", "2026-01-01"),
      makePage("b", "B", "2026-02-01"),
    ];
    setNotion(makeFakeClient(pages) as any);
    const r = await runSync("full");
    expect(r).toEqual({ ok: true, done: true });
    const rows = await cache.getAllRows();
    expect(rows).toHaveLength(2);
    const meta = await cache.getMeta();
    expect(meta.count).toBe(2);
    expect(meta.lastFullAt).not.toBeNull();
  });

  it("dos syncs simultáneos: el segundo recibe locked", async () => {
    setNotion(makeFakeClient([makePage("a", "A", "2026-01-01")]) as any);
    const [a, b] = await Promise.all([runSync("full"), runSync("full")]);
    const oks = [a, b].filter((x) => x.ok).length;
    expect(oks).toBe(1);
    const failed = [a, b].find((x) => !x.ok) as { ok: false; reason: string };
    expect(failed.reason).toBe("locked");
  });
});

describe("runSync full (empty result)", () => {
  it("no crashea ni borra cache previa cuando Notion devuelve 0 páginas", async () => {
    // sembrar cache previo con un sync que sí tiene datos
    setNotion(makeFakeClient([
      makePage("a", "A", "2026-01-01"),
    ]) as any);
    await runSync("full");
    expect(await cache.countRows()).toBe(1);
    const metaBefore = await cache.getMeta();

    // esperar para asegurar que el timestamp ISO difiera
    await new Promise((r) => setTimeout(r, 5));

    // ahora un full sync vacío
    setNotion(makeFakeClient([]) as any);
    const r = await runSync("full");
    expect(r).toEqual({ ok: true, done: true });

    // cache previo intacto
    expect(await cache.countRows()).toBe(1);
    // lastFullAt actualizado
    const metaAfter = await cache.getMeta();
    expect(metaAfter.lastFullAt).not.toBe(metaBefore.lastFullAt);
  });
});

describe("runSync incremental", () => {
  it("upsert y delete por archived", async () => {
    setNotion(makeFakeClient([
      makePage("a", "A", "2026-01-01"),
      makePage("b", "B", "2026-02-01"),
    ]) as any);
    await runSync("full");

    setNotion(makeFakeClient([
      makePage("b", "B2", "2026-02-15"),       // editada
      makePage("c", "C",  "2026-03-01"),       // nueva
      makePage("a", "A",  "2026-01-01", true), // archivada
    ]) as any);
    const r = await runSync("incremental");
    expect(r).toEqual({ ok: true, done: true });

    const rows = await cache.getAllRows();
    expect(rows).toHaveLength(2);
    const titles = rows.map((r: any) => r.Nombre).sort();
    expect(titles).toEqual(["B2", "C"]);
  });
});
