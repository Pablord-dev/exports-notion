import { describe, it, expect } from "vitest";
import { nextRun, cronSchedule } from "@/lib/cron";

describe("nextRun", () => {
  it("calcula el próximo disparo desde una fecha base", () => {
    const base = new Date("2026-05-17T10:30:00Z");
    expect(nextRun("0 */6 * * *", base).toISOString()).toBe("2026-05-17T12:00:00.000Z");
    expect(nextRun("0 9 * * *", base).toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });
});

describe("cronSchedule", () => {
  it("devuelve una expresión parseable para el kind que sí está en vercel.json", () => {
    const base = new Date("2026-05-17T10:30:00Z");
    const schedule = cronSchedule("incremental");
    expect(schedule).not.toBeNull();
    expect(() => nextRun(schedule!, base)).not.toThrow();
  });

  it("devuelve null para un kind sin cron en vez de lanzar", () => {
    // El full no se cronea (un cron dispara una sola invocación y no encadena
    // los tramos de SYNC_BUDGET_MS); se corre a mano desde la UI. Que devuelva
    // null y no una excepción es lo que mantiene vivo /api/sync/status, donde
    // cronSchedule se evalúa en el top-level del módulo.
    expect(cronSchedule("full")).toBeNull();
  });
});
