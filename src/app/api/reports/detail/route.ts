import { NextRequest, NextResponse } from "next/server";
import { reportDetail } from "@/lib/db";
import { parseReportFilters, parseLimit } from "@/lib/report-params";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = parseReportFilters(req.nextUrl.searchParams);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  const limit = parseLimit(req.nextUrl.searchParams);
  if (limit === null) return NextResponse.json({ error: "bad_limit" }, { status: 400 });
  const cursor = req.nextUrl.searchParams.get("cursor");
  const page = await reportDetail(p.filters, cursor, limit);
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
