import { NextResponse } from "next/server";
import { reportFilters } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const options = await reportFilters();
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
