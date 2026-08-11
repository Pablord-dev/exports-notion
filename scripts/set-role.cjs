// Promueve o degrada a un usuario. La tabla `users` es la única fuente de verdad
// de los roles, así que esto no requiere redeploy ni tocar variables de entorno.
//
// Uso: node scripts/set-role.cjs <email> <admin|viewer>   (lee DATABASE_URL de .env.local)
//
// Crea la fila si la persona todavía no entró nunca, así se puede dejar listo a un
// admin antes de su primer login.
const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const line of env) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const [, , emailRaw, role] = process.argv;
if (!emailRaw || (role !== "admin" && role !== "viewer")) {
  console.error("Uso: node scripts/set-role.cjs <email> <admin|viewer>");
  process.exit(1);
}
// Misma normalización que normalizeEmail en src/lib/authz.ts: este script no pasa
// por el Store, así que si no la repitiera crearía una segunda fila para la misma
// persona y la promoción no tendría efecto.
const email = emailRaw.trim().toLowerCase();

const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL);

(async () => {
  const [row] = await sql`
    insert into users (email, role) values (${email}, ${role})
    on conflict (email) do update set role = excluded.role
    returning email, role, last_login_at`;
  const visita = row.last_login_at ? row.last_login_at.toISOString() : "nunca entró";
  console.log(`${row.email} → ${row.role}  (último login: ${visita})`);
  await sql.end();
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
