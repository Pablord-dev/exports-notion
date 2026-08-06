// Destraba el login cuando el rate-limit se agotó probando la pantalla
// (5 intentos por IP cada 15 min, ventana fija en la tabla login_attempts).
// Borra sólo los contadores de intentos: no toca sesiones ni el snapshot.
//
// Uso: node scripts/reset-login-attempts.cjs   (lee DATABASE_URL de .env.local)
const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const line of env) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const postgres = require("postgres");
// prepare:false — el transaction pooler de Supabase (6543) no los soporta.
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

(async () => {
  const rows = await sql`delete from login_attempts returning ip, count`;
  console.log(`reset OK — ${rows.length} ventana(s) borrada(s)`);
  for (const r of rows) console.log(`  ${r.ip}: ${r.count} intento(s)`);
  await sql.end();
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
