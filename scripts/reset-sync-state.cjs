// Destraba un sync trancado (reinicio de dev o función matada en producción).
// Borra lock, cancel, pivote y flag de sesión, vacía el staging pages_new,
// y deja el status en idle. El snapshot vivo (pages) NO se toca.
//
// Uso: node scripts/reset-sync-state.cjs   (lee DATABASE_URL de .env.local)
const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const line of env) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL);

(async () => {
  await sql`delete from sync_state where key in ('lock', 'cancel', 'full:pivot', 'full:active')`;
  await sql`truncate pages_new`;
  const idle = { state: "idle", kind: null, done: 0, total: 0, startedAt: null, error: null, skipped: 0 };
  await sql`
    insert into sync_state (key, value, expires_at) values ('status', ${idle}::jsonb, null)
    on conflict (key) do update set value = excluded.value, expires_at = null`;
  console.log("reset OK");
  await sql.end();
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
