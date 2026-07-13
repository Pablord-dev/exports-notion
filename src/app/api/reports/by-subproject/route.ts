import { NextRequest, NextResponse } from "next/server";
import { reportBySubproject } from "@/lib/db";
import { parseReportFilters } from "@/lib/report-params";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = parseReportFilters(req.nextUrl.searchParams);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  const rows = await reportBySubproject(p.filters);
  return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
}
