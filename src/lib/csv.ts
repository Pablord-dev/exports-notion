import { stringify } from "csv-stringify";
import type { FlatRow } from "@/lib/types";

const BOM = "﻿";

/** Versión string (útil para tests). */
export async function rowsToCSVString(headers: string[], rows: FlatRow[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const stringifier = stringify({ header: true, columns: headers, quoted_string: false });
    let out = "";
    stringifier.on("readable", () => {
      let chunk;
      while ((chunk = stringifier.read())) out += chunk;
    });
    stringifier.on("error", reject);
    stringifier.on("finish", () => resolve(BOM + out));
    for (const row of rows) {
      const ordered = Object.fromEntries(headers.map((h) => [h, row[h] ?? ""]));
      stringifier.write(ordered);
    }
    stringifier.end();
  });
}

/** Versión streaming para HTTP responses. */
export function rowsToCSVStream(headers: string[], rows: FlatRow[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(BOM));
      const stringifier = stringify({ header: true, columns: headers, quoted_string: false });
      stringifier.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      stringifier.on("end", () => controller.close());
      stringifier.on("error", (err) => controller.error(err));
      for (const row of rows) {
        const ordered = Object.fromEntries(headers.map((h) => [h, row[h] ?? ""]));
        stringifier.write(ordered);
      }
      stringifier.end();
    },
  });
}
