import { NextRequest, NextResponse } from "next/server";
import { reportMatrix } from "@/lib/db";
import { parseReportFilters } from "@/lib/report-params";

export const dynamic = "force-dynamic";

// Matriz dimensión × semana ISO: ?dim=person|subproject + filtros estándar.
// La UI la usa con exactamente una persona (dim=subproject) o un subproyecto
// (dim=person) seleccionados, pero el endpoint acepta cualquier combinación.
export async function GET(req: NextRequest) {
  const dim = req.nextUrl.searchParams.get("dim");
  if (dim !== "person" && dim !== "subproject") {
    return NextResponse.json({ error: "bad_dim" }, { status: 400 });
  }
  const p = parseReportFilters(req.nextUrl.searchParams);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  const cells = await reportMatrix(p.filters, dim);
  return NextResponse.json({ cells }, { headers: { "Cache-Control": "no-store" } });
}
