import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/columns", () => ({
  COLUMNS: [{ notion: "Title", csv: "Nombre" }, { notion: "When" }],
  csvHeaders: () => ["Nombre", "When"],
}));

import { makeFakeClient, makePage } from "../fixtures/fakeNotion";
import { newMemoryStore } from "@/lib/memory-store";
import { __setStore } from "@/lib/db";
import { __setClient as setNotion } from "@/lib/notion";
import { runSync } from "@/lib/sync";
import * as cache from "@/lib/db";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** last_edited_time posterior a cualquier `since` calculado durante el test. */
const future = (mins = 5) => new Date(Date.now() + mins * 60_000).toISOString();
/** created_time únicos y decrecientes con i creciente (orden natural del full DESC). */
const ct = (i: number) => new Date(Date.UTC(2026, 0, 1) + (1000 - i) * 60_000).toISOString();

beforeEach(() => {
  process.env.NOTION_DATABASE_ID = "db-test";
  process.env.NOTION_TOKEN = "tok";
  delete process.env.SYNC_BUDGET_MS;
  __setStore(newMemoryStore());
});

describe("runSync full", () => {
  it("escribe en cache nuevo, promueve atómico, actualiza meta", async () => {
    const pages = [
      makePage("a", "A", "2026-01-01"),
      makePage("b", "B", "2026-02-01"),
    ];
    setNotion(makeFakeClient(pages) as any);
    const r = await runSync("full");
    expect(r).toMatchObject({ ok: true, done: true });
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
    await sleep(5);

    // ahora un full sync vacío
    setNotion(makeFakeClient([]) as any);
    const r = await runSync("full");
    expect(r).toMatchObject({ ok: true, done: true });

    // cache previo intacto
    expect(await cache.countRows()).toBe(1);
    // lastFullAt actualizado
    const metaAfter = await cache.getMeta();
    expect(metaAfter.lastFullAt).not.toBe(metaBefore.lastFullAt);
  });
});

describe("runSync incremental", () => {
  it("upsert de editadas/nuevas y delete de las mandadas a papelera (FX-001)", async () => {
    setNotion(makeFakeClient([
      makePage("a", "A", "2026-01-01"),
      makePage("b", "B", "2026-02-01"),
    ]) as any);
    await runSync("full");

    // La API real sólo expone la papelera si el query pide in_trash:true.
    setNotion(makeFakeClient([
      makePage("b", "B2", "2026-02-15", false, { last_edited_time: future() }), // editada
      makePage("c", "C", "2026-03-01", false, { last_edited_time: future() }),  // nueva
      makePage("a", "A", "2026-01-01", true, { last_edited_time: future() }),   // a papelera
    ]) as any);
    const r = await runSync("incremental");
    expect(r).toMatchObject({ ok: true, done: true });

    const rows = await cache.getAllRows();
    expect(rows).toHaveLength(2);
    const titles = rows.map((r: any) => r.Nombre).sort();
    expect(titles).toEqual(["B2", "C"]);
  });

  it("devuelve y persiste el contador del último sync (FX-003)", async () => {
    setNotion(makeFakeClient([
      makePage("a", "A", "2026-01-01"),
      makePage("b", "B", "2026-02-01"),
    ]) as any);
    await runSync("full");

    setNotion(makeFakeClient([
      makePage("b", "B2", "2026-02-15", false, { last_edited_time: future() }),
      makePage("c", "C", "2026-03-01", false, { last_edited_time: future() }),
      makePage("a", "A", "2026-01-01", true, { last_edited_time: future() }),
    ]) as any);
    const r = await runSync("incremental");
    expect(r).toMatchObject({ ok: true, done: true, upserted: 2, deleted: 1 });

    const st = await cache.getStatus();
    expect(st.lastResult).toMatchObject({ kind: "incremental", upserted: 2, deleted: 1, skipped: 0 });
    expect(st.lastResult?.finishedAt).toBeTruthy();
  });

  it("fija lastIncrementalAt al instante previo al fetch, no al final (FX-002)", async () => {
    setNotion(makeFakeClient([makePage("a", "A", "2026-01-01")]) as any);
    await runSync("full");

    const fake = makeFakeClient(
      [makePage("b", "B", "2026-02-01", false, { last_edited_time: future() })],
      { onQuery: () => sleep(60) },
    );
    setNotion(fake as any);
    await runSync("incremental");

    const meta = await cache.getMeta();
    const t = new Date(meta.lastIncrementalAt!).getTime();
    // El timestamp debe ser anterior (o igual) al momento en que salió el query a Notion;
    // si se fijara al final, sería >= 60ms después por el delay del fake.
    expect(t).toBeLessThanOrEqual(fake.__calls[0].at);
  });

  it("no avanza lastIncrementalAt si el incremental fue cancelado a mitad (FX-002)", async () => {
    setNotion(makeFakeClient([makePage("a", "A", "2026-01-01")]) as any);
    await runSync("full");
    const before = (await cache.getMeta()).lastIncrementalAt;

    const pages = Array.from({ length: 150 }, (_, i) =>
      makePage(`p${i}`, `T${i}`, "2026-01-01", false, { last_edited_time: future() }));
    setNotion(makeFakeClient(pages, {
      onQuery: async () => { await cache.requestCancel(); },
    }) as any);
    const r = await runSync("incremental");
    expect(r.ok).toBe(true);

    // lo ya traído se conserva (primer batch de 100 + la fila previa del full)…
    expect(await cache.countRows()).toBeGreaterThanOrEqual(100);
    // …pero la ventana NO avanza: el próximo incremental re-trae lo que faltó.
    expect((await cache.getMeta()).lastIncrementalAt).toBe(before);
  });
});

describe("runSync full reanudable (FX-004)", () => {
  it("con presupuesto agotado corta tras un batch, conserva el avance y reanuda hasta promover", async () => {
    process.env.SYNC_BUDGET_MS = "0";
    const pages = Array.from({ length: 250 }, (_, i) =>
      makePage(`p${i}`, `T${i}`, "2026-01-01", false, { created_time: ct(i) }));
    setNotion(makeFakeClient(pages) as any);

    const t0 = Date.now();
    const r1 = await runSync("full");
    const t1 = Date.now();
    expect(r1).toMatchObject({ ok: true, done: false });
    expect(await cache.countRowsNew()).toBe(100);
    expect(await cache.getFullPivot()).toBe(ct(99));
    expect(await cache.getFullActive()).not.toBeNull();

    // "muerte" de la función: no pasa nada más; el estado quedó en el store.
    const r2 = await runSync("full");
    expect(r2).toMatchObject({ ok: true, done: false });
    // 199 y no 200: el pivote on_or_before re-trae la página frontera (idempotente por id).
    expect(await cache.countRowsNew()).toBe(199);

    const r3 = await runSync("full");
    expect(r3).toMatchObject({ ok: true, done: true });
    expect(await cache.countRows()).toBe(250);
    expect(await cache.countRowsNew()).toBe(0);
    expect(await cache.getFullPivot()).toBeNull();
    expect(await cache.getFullActive()).toBeNull();

    // lastIncrementalAt = inicio del full (primer segmento), no el final (FX-002).
    const meta = await cache.getMeta();
    const inc = new Date(meta.lastIncrementalAt!).getTime();
    expect(inc).toBeGreaterThanOrEqual(t0);
    expect(inc).toBeLessThanOrEqual(t1);
  });

  it("el contador de progreso ACUMULA entre invocaciones encadenadas y el total final es el de la sesión (FX-006)", async () => {
    // Regresión: `processed`/`skipped`/`upserted` son locales a runFull(), así que
    // cada invocación encadenada los reiniciaba en 0 y patchStatus escribía
    // done: 100, 200… desde cero — en Vercel Hobby (SYNC_BUDGET_MS) la UI mostraba
    // el conteo reiniciándose en cada tramo. El total final reportaba sólo la
    // última invocación en vez de la sesión completa.
    process.env.SYNC_BUDGET_MS = "0";
    const pages = Array.from({ length: 250 }, (_, i) =>
      makePage(`p${i}`, `T${i}`, "2026-01-01", false, { created_time: ct(i) }));
    setNotion(makeFakeClient(pages) as any);

    await runSync("full");
    const done1 = (await cache.getStatus())!.done;
    expect(done1).toBe(100);

    // Segunda invocación: el contador debe SEGUIR desde 100, no volver a empezar.
    await runSync("full");
    const done2 = (await cache.getStatus())!.done;
    expect(done2).toBeGreaterThan(done1);
    // total nunca puede ir hacia atrás mientras la sesión sigue viva.
    expect((await cache.getStatus())!.total).toBeGreaterThanOrEqual(done2);

    const r3 = await runSync("full");
    // El total reportado es el de la SESIÓN (250 filas promovidas), no el del último tramo.
    expect(r3).toMatchObject({ ok: true, done: true, upserted: 250 });
    const st = await cache.getStatus();
    expect(st!.lastResult).toMatchObject({ kind: "full", upserted: 250 });
    expect(await cache.countRows()).toBe(250);
  });

  it("reintento tras muerte sin pivote NO borra el :new acumulado", async () => {
    // Estado simulado: un full murió a mitad del primer segmento (flag activo, sin pivote,
    // con avance parcial en :new).
    await cache.setFullActive(new Date().toISOString());
    await cache.upsertRows([{ id: "parcial", row: { Nombre: "Parcial", When: "" } }], "new");

    setNotion(makeFakeClient([
      makePage("a", "A", "2026-01-01"),
      makePage("b", "B", "2026-02-01"),
    ]) as any);
    const r = await runSync("full");
    expect(r).toMatchObject({ ok: true, done: true });
    // El avance previo sobrevive: la fila parcial sigue (re-upsert idempotente la habría
    // sobrescrito si viniera de Notion). Snapshot = 2 de Notion + 1 parcial.
    expect(await cache.countRows()).toBe(3);

    // El siguiente full es sesión nueva (flag limpio) → arranca limpio y purga huérfanos.
    const r2 = await runSync("full");
    expect(r2).toMatchObject({ ok: true, done: true });
    expect(await cache.countRows()).toBe(2);
  });

  it("cancel a mitad del full promueve lo cargado y limpia pivote y flag de sesión", async () => {
    const pages = Array.from({ length: 250 }, (_, i) =>
      makePage(`p${i}`, `T${i}`, "2026-01-01", false, { created_time: ct(i) }));
    setNotion(makeFakeClient(pages, {
      onQuery: async () => { await cache.requestCancel(); },
    }) as any);

    const r = await runSync("full");
    expect(r).toMatchObject({ ok: true, done: true });
    expect(await cache.countRows()).toBe(100); // primer batch guardado
    expect(await cache.getFullPivot()).toBeNull();
    expect(await cache.getFullActive()).toBeNull();
  });
});
