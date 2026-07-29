import { defineConfig, devices } from "@playwright/test";

// Por defecto el E2E corre contra un server con stubs en memoria (E2E_STUBS=1):
// no necesita Postgres ni Notion reales y usa su propio puerto para no chocar
// con un dev server abierto. Con E2E_REAL=1 vuelve al modo original: reutiliza
// (o levanta) el server del puerto 3000 con las credenciales de .env.local.
const REAL = process.env.E2E_REAL === "1";
const PORT = REAL ? 3000 : 3100;

// Password del entorno stub: "e2e-password" (resuelto en verifyPassword con
// E2E_STUBS=1). OJO: `next start` pisa el process.env heredado con .env.local
// (verificado empíricamente en Next 16.2.6, contra lo que dice la doc), así
// que los valores de aquí sólo surten efecto si NO hay .env.local — su único
// propósito es satisfacer el fail-fast de instrumentation.ts en máquinas sin
// credenciales. Todo el comportamiento stub real viaja por E2E_STUBS, que sí
// llega porque no existe en .env.local.
const STUB_ENV = {
  E2E_STUBS: "1",
  NOTION_TOKEN: "e2e-dummy",
  NOTION_DATABASE_ID: "e2e-dummy",
  DATE_COLUMN: "When",
  APP_PASSWORD_HASH: "e2e-dummy",
  SESSION_SECRET: "e2e-session-secret-of-32-chars!!",
  CRON_SECRET: "e2e-dummy",
  // Nunca se conecta (E2E_STUBS=1 usa memoryStore), pero loadConfig la exige.
  DATABASE_URL: "postgresql://e2e:e2e@127.0.0.1:1/e2e",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Stub: build + next start en su propio puerto — `next dev` tiene un lock
    // por proyecto en Next 16 y chocaría con un dev server abierto.
    command: REAL ? "npm run dev" : `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    ...(REAL ? {} : { env: STUB_ENV }),
  },
});
