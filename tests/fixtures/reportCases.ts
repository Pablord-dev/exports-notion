// Casos de reportes compartidos: corren idénticos contra el pgStore real
// (db.pg.test.ts, gated PG_TEST) y contra memory-store (reports.memory.test.ts).
// Si ambas implementaciones pasan las mismas aserciones, el stub es fiel.
// Fechas elegidas con calendario conocido: 2026-06-01 fue LUNES (semanas ISO).
import { expect } from "vitest";
import type * as DB from "@/lib/db";

const mk = (id: string, persona: string, sub: string, proj: string, comp: string, fecha: string, horas: string) => ({
  id,
  row: {
    "ID": id,
    "Persona": persona,
    "Subproyecto": sub,
    "Proyecto": proj,
    "Empresa productiva": comp,
    "Hora de creación": fecha,
    "Registro de horas": horas,
    "Breve descripción": `fila ${id}`,
  },
});

export const REPORT_SEED = [
  mk("r1", "Ana", "Alpha", "P1", "ACME", "2026-06-02T10:00:00.000Z", "2"),
  // espacios alrededor: el trim debe fusionarla con "Ana"/"Alpha"
  mk("r2", "Ana ", "Alpha ", "", "ACME", "2026-06-03T10:00:00.000Z", "1.5"),
  // sin subproyecto/proyecto/empresa: no se pierde (grupo null)
  mk("r3", "Beto", "", "", "", "2026-06-09T10:00:00.000Z", "3"),
  // mismo timestamp que r1: desempata el keyset por id desc
  mk("r5", "Beto", "Alpha", "P1", "", "2026-06-02T10:00:00.000Z", "1"),
  // julio + horas no numéricas → 0
  mk("r4", "Ana", "Beta", "P2", "OTRA", "2026-07-01T10:00:00.000Z", "x"),
];

const JUN = { from: "2026-06-01", to: "2026-06-30" };

export async function runReportAssertions(db: typeof DB) {
  await db.upsertRows(REPORT_SEED);

  // by-person: suma de horas y conteo, orden horas desc; trim fusiona "Ana "
  expect(await db.reportByPerson(JUN)).toEqual([
    { person: "Beto", hours: 4, count: 2 },
    { person: "Ana", hours: 3.5, count: 2 },
  ]);

  // by-subproject: trim fusiona "Alpha "; los sin subproyecto quedan como grupo null
  expect(await db.reportBySubproject(JUN)).toEqual([
    { subproject: "Alpha", project: "P1", company: "ACME", hours: 4.5, count: 3 },
    { subproject: null, project: null, company: null, hours: 3, count: 1 },
  ]);

  // timeline semanal ISO (lunes): 2026-06-01 y 2026-06-08
  expect(await db.reportTimeline(JUN, "week")).toEqual([
    { bucket: "2026-06-01", hours: 4.5, count: 3 },
    { bucket: "2026-06-08", hours: 3, count: 1 },
  ]);

  // timeline mensual con horas no numéricas → 0 (la fila cuenta, no suma)
  expect(await db.reportTimeline({ from: "2026-06-01", to: "2026-07-31" }, "month")).toEqual([
    { bucket: "2026-06-01", hours: 7.5, count: 4 },
    { bucket: "2026-07-01", hours: 0, count: 1 },
  ]);

  // detail: keyset (created_at desc, id desc), paginado estable con timestamps empatados
  const p1 = await db.reportDetail(JUN, null, 2);
  expect(p1.rows.map((r) => r["ID"])).toEqual(["r3", "r2"]);
  expect(p1.nextCursor).not.toBeNull();
  const p2 = await db.reportDetail(JUN, p1.nextCursor, 2);
  expect(p2.rows.map((r) => r["ID"])).toEqual(["r5", "r1"]);
  expect(p2.nextCursor).toBeNull();

  // filtros combinables
  expect(await db.reportByPerson({ ...JUN, people: ["Ana"] })).toEqual([
    { person: "Ana", hours: 3.5, count: 2 },
  ]);
  expect(await db.reportByPerson({ ...JUN, companies: ["ACME"] })).toEqual([
    { person: "Ana", hours: 3.5, count: 2 },
  ]);
  expect(await db.reportBySubproject({ ...JUN, subprojects: ["Alpha"] })).toEqual([
    { subproject: "Alpha", project: "P1", company: "ACME", hours: 4.5, count: 3 },
  ]);

  // catálogo de filtros: valores únicos, trim aplicado, orden alfabético
  expect(await db.reportFilters()).toEqual({
    people: ["Ana", "Beto"],
    subprojects: ["Alpha", "Beta"],
    projects: ["P1", "P2"],
    companies: ["ACME", "OTRA"],
  });
}
