import { NextResponse } from "next/server";
import { getStatus, getMeta } from "@/lib/db";
import { nextRun, cronSchedule } from "@/lib/cron";

export const dynamic = "force-dynamic";

const CRON_INCREMENTAL = cronSchedule("incremental");
const CRON_FULL = cronSchedule("full");

export async function GET() {
  const now = new Date();
  const [status, meta] = await Promise.all([getStatus(), getMeta()]);
  return NextResponse.json({
    status, meta,
    // null = ese kind no está croneado (se dispara sólo a mano desde la UI).
    next: {
      incremental: CRON_INCREMENTAL ? nextRun(CRON_INCREMENTAL, now).toISOString() : null,
      full: CRON_FULL ? nextRun(CRON_FULL, now).toISOString() : null,
    },
  });
}
