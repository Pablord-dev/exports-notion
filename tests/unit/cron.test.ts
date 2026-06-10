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
  it("encuentra en vercel.json una expresión cron parseable para cada kind", () => {
    const base = new Date("2026-05-17T10:30:00Z");
    for (const kind of ["incremental", "full"] as const) {
      const schedule = cronSchedule(kind);
      expect(() => nextRun(schedule, base)).not.toThrow();
    }
  });
});
