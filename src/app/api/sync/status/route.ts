import { NextResponse } from "next/server";
import { getStatus, getMeta } from "@/lib/cache";
import { nextRun } from "@/lib/cron";

export const dynamic = "force-dynamic";

const CRON_INCREMENTAL = "0 */6 * * *";
const CRON_FULL = "0 9 * * *";

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
