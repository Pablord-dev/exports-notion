import { NextRequest, NextResponse } from "next/server";
import { getAllRows, countRows } from "@/lib/cache";
import { filterByDateRange } from "@/lib/filter";
import { rowsToCSVStream } from "@/lib/csv";
import { csvHeaders, COLUMNS } from "@/lib/columns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (from && !ISO_DATE.test(from)) return NextResponse.json({ error: "bad_from" }, { status: 400 });
  if (to && !ISO_DATE.test(to)) return NextResponse.json({ error: "bad_to" }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ error: "from_after_to" }, { status: 400 });

  if ((await countRows()) === 0) {
    return NextResponse.json({ error: "no_data", message: "Aún no hay datos. Corre el primer sync." }, { status: 503 });
  }

  const headers = csvHeaders();
  const all = await getAllRows();
  const filtered = filterByDateRange(all, from, to, process.env.DATE_COLUMN!);

  // Re-resolver el nombre CSV de DATE_COLUMN para advertir si no está en whitelist
  const dateColInWhitelist = COLUMNS.some((c) => c.notion === process.env.DATE_COLUMN);
  if (!dateColInWhitelist) {
    return NextResponse.json({ error: "date_column_not_in_whitelist" }, { status: 500 });
  }

  const stream = rowsToCSVStream(headers, filtered);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const fname = `export-${from ?? "all"}-${to ?? "all"}-${stamp}.csv`;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
