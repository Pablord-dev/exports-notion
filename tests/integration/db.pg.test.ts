// Test de integración de db.ts contra el Postgres local de Supabase.
// Gated: sólo corre con PG_TEST=1 (requiere `supabase start` y el esquema aplicado).
//   PG_TEST=1 npx vitest run tests/integration/db.pg.test.ts
// Verifica el SQL real (unnest/upsert, swap transaccional, KV con TTL) — lo que
// el fake en memoria no puede cubrir.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";

const RUN = process.env.PG_TEST === "1";
const URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const row = (id: string, extra: Record<string, string> = {}) => ({
  id,
  row: {
    "ID": id,
    "Registro de horas": "2.5",
    "Hora de creación": "2026-06-01T10:00:00.000Z",
    "Hora de última edición": "2026-06-02T10:00:00.000Z",
    "Hecho por (no tocar)": "person-1",
    "Subproyecto (no tocar)": "sub-1",
    "Proyecto (no tocar)": "",
    "Empresa productiva": "INTERNO",
    "Breve descripción": "fila de prueba",
    ...extra,
  },
});

describe.runIf(RUN)("db.ts contra Postgres real", () => {
  let db: typeof import("@/lib/db");
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.DATE_COLUMN = "Hora de creación";
    db = await import("@/lib/db");
    sql = postgres(URL);
  });
  afterAll(async () => {
    await db.closeDb();
    await sql.end();
  });
  beforeEach(async () => {
    await sql`truncate pages, pages_new, sync_state, login_attempts`;
  });

  it("upsert parsea columnas tipadas y el jsonb queda íntegro", async () => {
    await db.upsertRows([row("p1"), row("p2", { "Registro de horas": "no-numérico", "Proyecto (no tocar)": "proj-9" })]);
    const rs = await sql`select * from pages order by id`;
    expect(rs).toHaveLength(2);
    expect(Number(rs[0].hours)).toBe(2.5);
    expect(rs[0].person_id).toBe("person-1");
    expect(rs[0].subproject_id).toBe("sub-1");
    expect(rs[0].project_id).toBeNull(); // string vacío → null
    expect(rs[0].company).toBe("INTERNO");
    expect(rs[0].created_at.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(Number(rs[1].hours)).toBe(0); // no numérico → 0
    expect(rs[1].project_id).toBe("proj-9");
    expect((rs[0].row as Record<string, string>)["Breve descripción"]).toBe("fila de prueba");
  });

  it("upsert del mismo id actualiza en vez de duplicar", async () => {
    await db.upsertRows([row("p1")]);
    await db.upsertRows([row("p1", { "Registro de horas": "8" })]);
    expect(await db.countRows()).toBe(1);
    const rs = await sql`select hours from pages`;
    expect(Number(rs[0].hours)).toBe(8);
  });

  it("deleteRows borra por id", async () => {
    await db.upsertRows([row("p1"), row("p2")]);
    await db.deleteRows(["p1"]);
    expect(await db.countRows()).toBe(1);
  });

  it("getAllRows devuelve las filas planas", async () => {
    await db.upsertRows([row("p1")]);
    const rows = await db.getAllRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]["ID"]).toBe("p1");
  });

  it("promoteNewCache reemplaza el vivo con el staging y lo vacía", async () => {
    await db.upsertRows([row("viejo")], "current");
    await db.upsertRows([row("nuevo1"), row("nuevo2")], "new");
    await db.promoteNewCache();
    expect(await db.countRows()).toBe(2);
    expect(await db.countRowsNew()).toBe(0);
    const rows = await db.getAllRows();
    expect(rows.map((r) => r["ID"]).sort()).toEqual(["nuevo1", "nuevo2"]);
  });

  it("meta y status persisten con defaults", async () => {
    expect((await db.getMeta()).count).toBe(0);
    await db.setMeta({ lastFullAt: "2026-07-08T00:00:00.000Z", lastIncrementalAt: null, count: 5 });
    expect((await db.getMeta()).count).toBe(5);
    expect((await db.getStatus()).state).toBe("idle");
    await db.patchStatus({ state: "running", kind: "full" });
    const st = await db.getStatus();
    expect(st.state).toBe("running");
    expect(st.kind).toBe("full");
  });

  it("lock: NX + expiración", async () => {
    expect(await db.acquireLock(600)).toBe(true);
    expect(await db.acquireLock(600)).toBe(false); // ya tomado
    await db.releaseLock();
    expect(await db.acquireLock(600)).toBe(true);
    // lock vencido se puede retomar
    await sql`update sync_state set expires_at = now() - interval '1 second' where key = 'lock'`;
    expect(await db.acquireLock(600)).toBe(true);
  });

  it("cancel y pivote respetan el TTL emulado", async () => {
    expect(await db.isCancelRequested()).toBe(false);
    await db.requestCancel(3600);
    expect(await db.isCancelRequested()).toBe(true);
    await db.clearCancel();
    expect(await db.isCancelRequested()).toBe(false);

    expect(await db.getFullPivot()).toBeNull();
    await db.setFullPivot("2026-06-01T00:00:00.000Z");
    expect(await db.getFullPivot()).toBe("2026-06-01T00:00:00.000Z");
    // vencido cuenta como ausente
    await sql`update sync_state set expires_at = now() - interval '1 second' where key = 'full:pivot'`;
    expect(await db.getFullPivot()).toBeNull();

    expect(await db.getFullActive()).toBeNull();
    await db.setFullActive("2026-07-08T09:00:00.000Z");
    expect(await db.getFullActive()).toBe("2026-07-08T09:00:00.000Z");
    await db.clearFullActive();
    expect(await db.getFullActive()).toBeNull();
  });

  it("rateLimitLogin: 5 intentos pasan, el 6º se bloquea; otra IP no se afecta", async () => {
    for (let i = 0; i < 5; i++) expect(await db.rateLimitLogin("1.2.3.4")).toBe(true);
    expect(await db.rateLimitLogin("1.2.3.4")).toBe(false);
    expect(await db.rateLimitLogin("5.6.7.8")).toBe(true);
    // ventana nueva = contador nuevo
    await sql`update login_attempts set window_start = window_start - interval '16 minutes' where ip = '1.2.3.4'`;
    expect(await db.rateLimitLogin("1.2.3.4")).toBe(true);
  });
});
