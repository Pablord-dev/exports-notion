import { NextRequest, NextResponse } from "next/server";
import { reportTimeline } from "@/lib/db";
import { parseReportFilters, parseGranularity } from "@/lib/report-params";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = parseReportFilters(req.nextUrl.searchParams);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  const granularity = parseGranularity(req.nextUrl.searchParams);
  if (!granularity) return NextResponse.json({ error: "bad_granularity" }, { status: 400 });
  const buckets = await reportTimeline(p.filters, granularity);
  return NextResponse.json({ granularity, buckets }, { headers: { "Cache-Control": "no-store" } });
}
