// src/instrumentation.ts
// Fail-fast (UP-06): valida las 9 env vars al arrancar el server, antes de
// atender requests. Sin esto, una env var faltante sólo explota en la primera
// request que la usa (p. ej. Redis.fromEnv() tirando el handler de login).
export async function register() {
  // `next build` no necesita credenciales; sólo el server en runtime.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { loadConfig } = await import("@/lib/config");
  loadConfig(); // lanza listando las faltantes
}
