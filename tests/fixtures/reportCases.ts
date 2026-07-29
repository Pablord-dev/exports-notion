// Casos de reportes compartidos: corren idénticos contra el pgStore real
// (db.pg.test.ts, gated TEST_DATABASE_URL) y contra memory-store (reports.memory.test.ts).
// Si ambas implementaciones pasan las mismas aserciones, el stub es fiel.
// Fechas elegidas con calendario conocido: 2026-06-01 fue LUNES (semanas ISO).
import { expect } from "vitest";
import type * as DB from "@/lib/db";

// Persona: agrupa/filtra por el ID de "Hecho por (no tocar)" y muestra el
// nombre de "Hecho por" (REPORT_PROPS.person / personLabel).
const mk = (id: string, personId: string, personName: string, sub: string, proj: string, comp: string, fecha: string, horas: string, extra: Record<string, string> = {}) => ({
  id,
  row: {
    "ID": id,
    "Hecho por (no tocar)": personId,
    "Hecho por": personName,
    "Subproyecto": sub,
    "Proyecto": proj,
    "Empresa productiva": comp,
    "Hora de creación": fecha,
    "Registro de horas": horas,
    "Breve descripción": `fila ${id}`,
    ...extra,
  },
});

export const REPORT_SEED = [
  mk("r1", "u-ana", "Ana", "Alpha", "P1", "ACME", "2026-06-02T10:00:00.000Z", "2"),
  // espacios alrededor: el trim debe fusionarla con "u-ana"/"Alpha"
  mk("r2", "u-ana ", "Ana", "Alpha ", "", "ACME", "2026-06-03T10:00:00.000Z", "1.5"),
  // sin subproyecto/proyecto/empresa: no se pierde (grupo null)
  mk("r3", "u-beto", "Beto", "", "", "", "2026-06-09T10:00:00.000Z", "3"),
  // mismo timestamp que r1: desempata el keyset por id desc
  mk("r5", "u-beto", "Beto", "Alpha", "P1", "", "2026-06-02T10:00:00.000Z", "1"),
  // julio + horas no numéricas → 0
  mk("r4", "u-ana", "Ana", "Beta", "P2", "OTRA", "2026-07-01T10:00:00.000Z", "x"),
  // r6: sin "Hecho por" — el nombre cae al respaldo "Persona"
  mk("r6", "u-cleo", "", "", "", "", "2026-07-01T12:00:00.000Z", "2", { "Persona": "Cleo" }),
  // r7: sin "Hecho por" y "Persona" con pinta de UUID → se descarta, label null
  mk("r7", "u-dexa", "", "", "", "", "2026-07-02T12:00:00.000Z", "1", { "Persona": "1ded872b-594c-811e-9e1b-00028a5d5461" }),
];

const JUN = { from: "2026-06-01", to: "2026-06-30" };

export async function runReportAssertions(db: typeof DB) {
  await db.upsertRows(REPORT_SEED);

  // by-person: agrupa por ID con label visible; trim fusiona "u-ana "
  expect(await db.reportByPerson(JUN)).toEqual([
    { person: "u-beto", label: "Beto", hours: 4, count: 2 },
    { person: "u-ana", label: "Ana", hours: 3.5, count: 2 },
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
    { bucket: "2026-07-01", hours: 3, count: 3 },
  ]);

  // detail: keyset (created_at desc, id desc), paginado estable con timestamps empatados
  const p1 = await db.reportDetail(JUN, null, 2);
  expect(p1.rows.map((r) => r["ID"])).toEqual(["r3", "r2"]);
  expect(p1.nextCursor).not.toBeNull();
  const p2 = await db.reportDetail(JUN, p1.nextCursor, 2);
  expect(p2.rows.map((r) => r["ID"])).toEqual(["r5", "r1"]);
  expect(p2.nextCursor).toBeNull();

  // sin rango: todos los registros (r4 de julio entra; sus horas "x" suman 0).
  // r6 toma el nombre del respaldo "Persona"; r7 lo descarta (UUID) → label null.
  expect(await db.reportByPerson({})).toEqual([
    { person: "u-beto", label: "Beto", hours: 4, count: 2 },
    { person: "u-ana", label: "Ana", hours: 3.5, count: 3 },
    { person: "u-cleo", label: "Cleo", hours: 2, count: 1 },
    { person: "u-dexa", label: null, hours: 1, count: 1 },
  ]);
  // cota suelta: solo "desde" (julio en adelante)
  expect(await db.reportByPerson({ from: "2026-07-01" })).toEqual([
    { person: "u-cleo", label: "Cleo", hours: 2, count: 1 },
    { person: "u-dexa", label: null, hours: 1, count: 1 },
    { person: "u-ana", label: "Ana", hours: 0, count: 1 },
  ]);

  // filtros combinables (people filtra por ID)
  expect(await db.reportByPerson({ ...JUN, people: ["u-ana"] })).toEqual([
    { person: "u-ana", label: "Ana", hours: 3.5, count: 2 },
  ]);
  expect(await db.reportByPerson({ ...JUN, companies: ["ACME"] })).toEqual([
    { person: "u-ana", label: "Ana", hours: 3.5, count: 2 },
  ]);
  expect(await db.reportBySubproject({ ...JUN, subprojects: ["Alpha"] })).toEqual([
    { subproject: "Alpha", project: "P1", company: "ACME", hours: 4.5, count: 3 },
  ]);

  // matriz × semana: 1 persona (por ID) → filas por subproyecto, sin label
  expect(await db.reportMatrix({ ...JUN, people: ["u-ana"] }, "subproject")).toEqual([
    { group: "Alpha", label: null, bucket: "2026-06-01", hours: 3.5 },
  ]);
  // 1 subproyecto → filas por persona (ID + nombre); orden bucket asc, group asc
  expect(await db.reportMatrix({ ...JUN, subprojects: ["Alpha"] }, "person")).toEqual([
    { group: "u-ana", label: "Ana", bucket: "2026-06-01", hours: 3.5 },
    { group: "u-beto", label: "Beto", bucket: "2026-06-01", hours: 1 },
  ]);
  // sin rango + grupo null (registro sin subproyecto) al final de su semana
  expect(await db.reportMatrix({ people: ["u-beto"] }, "subproject")).toEqual([
    { group: "Alpha", label: null, bucket: "2026-06-01", hours: 1 },
    { group: null, label: null, bucket: "2026-06-08", hours: 3 },
  ]);

  // catálogo de filtros: personas como pares {value: ID, label: nombre};
  // sin nombre resoluble (u-dexa) el label cae al propio ID.
  expect(await db.reportFilters()).toEqual({
    people: [
      { value: "u-ana", label: "Ana" },
      { value: "u-beto", label: "Beto" },
      { value: "u-cleo", label: "Cleo" },
      { value: "u-dexa", label: "u-dexa" },
    ],
    subprojects: ["Alpha", "Beta"],
    projects: ["P1", "P2"],
    companies: ["ACME", "OTRA"],
  });
}
