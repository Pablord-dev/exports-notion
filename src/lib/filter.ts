import type { FlatRow } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function parseRowDate(value: string): string | null {
  if (!value) return null;
  const candidate = value.split("→")[0].trim();
  return ISO_DATE.test(candidate) ? candidate.slice(0, 10) : null;
}

export function filterByDateRange(
  rows: FlatRow[],
  from: string | null,
  to: string | null,
  dateColumn: string,
): FlatRow[] {
  if (!from && !to) return rows;
  return rows.filter((row) => {
    const d = parseRowDate(row[dateColumn] ?? "");
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}
