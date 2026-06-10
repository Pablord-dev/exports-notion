import { NextResponse } from "next/server";
import { getStatus, getMeta } from "@/lib/cache";
import { nextRun, cronSchedule } from "@/lib/cron";

export const dynamic = "force-dynamic";

const CRON_INCREMENTAL = cronSchedule("incremental");
const CRON_FULL = cronSchedule("full");

export async function GET() {
  const now = new Date();
  const [status, meta] = await Promise.all([getStatus(), getMeta()]);
  return NextResponse.json({
    status, meta,
    next: {
      incremental: nextRun(CRON_INCREMENTAL, now).toISOString(),
      full: nextRun(CRON_FULL, now).toISOString(),
    },
  });
}
