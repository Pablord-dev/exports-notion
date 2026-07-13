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
test("login succeeds and dashboard renders", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await page.goto("/");
  await page.getByPlaceholder("Contraseña").fill("e2e-password");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("button", { name: "Incremental" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Full" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
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
  await expect(page.getByRole("link", { name: "← Exportar CSV" })).toBeVisible();
});
