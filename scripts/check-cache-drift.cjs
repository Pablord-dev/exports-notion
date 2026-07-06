// Verificador de drift (solo lectura): compara páginas editadas recientemente en Notion
// contra la fila cacheada en el hash vivo. Si la fila cacheada tiene "Hora de última
// edición" anterior a la real → el cache quedó con datos viejos (snapshot desactualizado).
// Origen: repro del incident report docs/reports/202606101520_incident_report_sync_incremental.md
//
// Uso: node scripts/check-cache-drift.cjs [sinceISO]
//   sinceISO opcional (default: últimas 24 h), p. ej. 2026-06-10T06:00:00.000Z
const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const line of env) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const { Client } = require("@notionhq/client");
const { Redis } = require("@upstash/redis");
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const redis = Redis.fromEnv();

(async () => {
  const ds = process.env.NOTION_DATABASE_ID;
  const since = process.argv[2] ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const filter = { timestamp: "last_edited_time", last_edited_time: { after: since } };

  let cursor = undefined;
  const editadas = [];
  do {
    const resp = await notion.dataSources.query({
      data_source_id: ds, page_size: 100, start_cursor: cursor, filter,
    });
    editadas.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
    await new Promise((r) => setTimeout(r, 350));
  } while (cursor);

  console.log(`Páginas editadas en Notion desde ${since}: ${editadas.length}`);

  let stale = 0, fresh = 0, missing = 0;
  const ejemplos = [];
  for (const p of editadas) {
    const row = await redis.hget("notion:cache:v1", p.id);
    if (!row) { missing++; continue; }
    const cachedEdit = row["Hora de última edición"];
    const realEdit = p.last_edited_time;
    if (cachedEdit && new Date(cachedEdit).getTime() < new Date(realEdit).getTime()) {
      stale++;
      if (ejemplos.length < 10) ejemplos.push({ id: p.id.slice(0, 8), cache: cachedEdit, notion: realEdit });
    } else {
      fresh++;
    }
  }
  console.log(`Resultado → frescas: ${fresh} | DESACTUALIZADAS en cache: ${stale} | no presentes en cache: ${missing}`);
  console.log("Ejemplos de filas desactualizadas:", JSON.stringify(ejemplos, null, 2));
})().catch((e) => {
  console.error("ERROR", e.status ?? e.code, e.message);
  process.exit(1);
});
