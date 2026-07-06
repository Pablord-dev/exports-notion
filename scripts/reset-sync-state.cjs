// Destraba un sync trancado (reinicio de dev o función matada en producción).
// Borra lock, cancel, pivote y el cache :new en construcción, y deja el status en idle.
// El cache vivo (notion:cache:v1) NO se toca.
//
// Uso: node scripts/reset-sync-state.cjs   (lee credenciales de .env.local)
const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const line of env) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const { Redis } = require("@upstash/redis");
const r = Redis.fromEnv();

(async () => {
  await r.del("notion:sync:lock", "notion:sync:cancel", "notion:sync:full:pivot", "notion:sync:full:active", "notion:cache:v1:new");
  await r.set("notion:sync:status", { state: "idle", kind: null, done: 0, total: 0, startedAt: null, error: null, skipped: 0 });
  console.log("reset OK");
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
