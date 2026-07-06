import bcrypt from "bcryptjs";

export { sessionOptions, type SessionData } from "./session";

export async function verifyPassword(plain: string): Promise<boolean> {
  // E2E_STUBS=1 (Playwright local): password fijo conocido. No va por env var
  // porque `next start` (Next 16.2.6) pisa el process.env heredado con los
  // valores de .env.local (verificado empíricamente 2026-07-06) — la bandera
  // E2E_STUBS sí pasa porque no existe en .env.local.
  if (process.env.E2E_STUBS === "1") return plain === "e2e-password";
  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
