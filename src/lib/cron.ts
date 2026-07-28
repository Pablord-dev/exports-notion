import { CronExpressionParser } from "cron-parser";
import vercelConfig from "../../vercel.json";
import type { SyncKind } from "@/lib/types";

export function nextRun(expression: string, from: Date = new Date()): Date {
  const it = CronExpressionParser.parse(expression, { currentDate: from, tz: "UTC" });
  return it.next().toDate();
}

// vercel.json es la única fuente de verdad de los schedules; derivarlos de ahí
// evita que la UI muestre una próxima corrida que no coincide con el cron real.
// Devuelve null si ese kind no tiene cron: la AUSENCIA es configuración válida,
// no un error. El full no se cronea en planes con timeout corto (Vercel Hobby,
// 60s) porque un cron dispara UNA invocación y no encadena los tramos que deja
// SYNC_BUDGET_MS — el full se corre a mano desde la UI, que sí encadena.
export function cronSchedule(kind: SyncKind): string | null {
  const cron = vercelConfig.crons.find((c) => c.path.includes(`kind=${kind}`));
  return cron?.schedule ?? null;
}
