import { CronExpressionParser } from "cron-parser";

export function nextRun(expression: string, from: Date = new Date()): Date {
  const it = CronExpressionParser.parse(expression, { currentDate: from, tz: "UTC" });
  return it.next().toDate();
}
