// Test de integración de db.ts contra un Postgres REAL.
// Verifica el SQL real (unnest/upsert, swap transaccional, KV con TTL) — lo que
// el fake en memoria no puede cubrir (ahí se encontró el doble-encoding de jsonb).
//
// Gated por TEST_DATABASE_URL: sin esa variable el test se salta. Ya no existe el
// Postgres local (`supabase start`) — el proyecto es cloud-only (ADR 0007).
//   TEST_DATABASE_URL="postgresql://…pooler.supabase.com:6543/postgres" \
//     npx vitest run tests/integration/db.pg.test.ts
//
// ⚠️ TEST_DATABASE_URL debe apuntar a un PROYECTO SUPABASE DEDICADO A TESTS, jamás
// al del app: este test DROPEA las tablas en beforeAll y las TRUNCA en cada test.
// Una corrida contra la base real borró el snapshot de 21k filas (2026-07-13).
// Hay dos guardas abajo, pero la única protección de verdad es un proyecto aparte.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { runReportAssertions } from "../fixtures/reportCases";

const URL = process.env.TEST_DATABASE_URL ?? "";
const RUN = URL.length > 0;

// Guarda 1 (estática): la URL de test no puede ser la del app.
if (RUN && process.env.DATABASE_URL && URL === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL es igual a DATABASE_URL. Este test borra las tablas: " +
    "apúntalo a un proyecto Supabase dedicado a tests.",
  );
}

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
    // prepare:false igual que en db.ts — el pooler de Supabase no soporta
    // prepared statements (ver ADR 0007).
    sql = postgres(URL, { prepare: false });

    // Guarda 2 (dinámica, la que de verdad protege): si la base destino ya tiene un
    // snapshot con filas, no es una base de test. Aborta antes de dropear nada.
    // Esta guarda funciona aunque DATABASE_URL no esté cargada en el entorno de tests.
    const [t] = await sql`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name = 'pages'`;
    if (t.n) {
      const [{ n }] = await sql`select count(*)::int as n from pages`;
      if (n > 0) {
        await sql.end();
        throw new Error(
          `La base de TEST_DATABASE_URL tiene ${n} filas en "pages": parece la base real del app, ` +
          "no una de tests. Abortado para no borrar el snapshot.",
        );
      }
    }

    // Partir de cero: la migración usa `create table` sin IF NOT EXISTS.
    await sql.unsafe("drop table if exists pages, pages_new, sync_state, login_attempts cascade");
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const f of fs.readdirSync(dir).sort()) {
      await sql.unsafe(fs.readFileSync(path.join(dir, f), "utf8"));
    }
    process.env.DATABASE_URL = URL;
    process.env.DATE_COLUMN = "Hora de creación";
    db = await import("@/lib/db");
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

  it("reportes: pasa los casos compartidos contra el SQL real", async () => {
    await runReportAssertions(db);
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
