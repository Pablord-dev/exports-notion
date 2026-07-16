import { test, expect } from "@playwright/test";

test("login screen renders and rejects wrong password", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Contraseña")).toBeVisible();
  await page.getByPlaceholder("Contraseña").fill("incorrecto");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/Contraseña incorrecta|Demasiados intentos/)).toBeVisible();
});

// Sólo en modo stub (default): el password del entorno E2E es conocido.
// Con E2E_REAL=1 se salta — no conocemos el password real.
test("login shows main menu and DB dashboard renders", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await page.goto("/");
  await page.getByPlaceholder("Contraseña").fill("e2e-password");
  await page.getByRole("button", { name: "Entrar" }).click();
  // Menú principal: tarjeta de la BD con sus dos accesos.
  await expect(page.getByRole("heading", { name: "Bases de datos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BD Tiempos" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  // Entrar al dashboard de la BD: sync + export.
  await page.getByRole("link", { name: "Exportar y sincronizar" }).click();
  await expect(page.getByRole("heading", { name: "BD Tiempos" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Incremental" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Full" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();
});

// Reportes (SB-13/14): con el store en memoria vacío la página debe cargar
// con filtros visibles y estados vacíos — nunca romper.
test("reports page renders filters and empty state", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await page.goto("/");
  await page.getByPlaceholder("Contraseña").fill("e2e-password");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("link", { name: "Reportes" }).click();
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Persona" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subproyecto" })).toBeVisible();
  await expect(page.getByText("Sin registros en el rango seleccionado.")).toBeVisible();
  await expect(page.getByRole("link", { name: "← BD Tiempos" })).toBeVisible();
});

// La ruta vieja /reports redirige a la nueva ubicación bajo su BD.
test("legacy /reports redirects to /db/tiempos/reports", async ({ page }) => {
  await page.goto("/reports");
  await page.waitForURL("**/db/tiempos/reports");
  expect(page.url()).toContain("/db/tiempos/reports");
});
