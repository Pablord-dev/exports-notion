import { CronExpressionParser } from "cron-parser";
import vercelConfig from "../../vercel.json";
import type { SyncKind } from "@/lib/types";

export function nextRun(expression: string, from: Date = new Date()): Date {
  const it = CronExpressionParser.parse(expression, { currentDate: from, tz: "UTC" });
  return it.next().toDate();
}

// vercel.json es la única fuente de verdad de los schedules; derivarlos de ahí
// evita que la UI muestre una próxima corrida que no coincide con el cron real.
export function cronSchedule(kind: SyncKind): string {
  const cron = vercelConfig.crons.find((c) => c.path.includes(`kind=${kind}`));
  if (!cron) throw new Error(`no cron in vercel.json for kind=${kind}`);
  return cron.schedule;
}
