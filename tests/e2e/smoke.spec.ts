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
  // Menú principal: tarjeta de la BD + sidebar anclada (default desktop).
  await expect(page.getByRole("heading", { name: "Bases de datos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BD Tiempos" })).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  // Entrar al dashboard de la BD desde la tarjeta: sync + export.
  await page.locator("main").getByRole("link", { name: "Exportar y sincronizar" }).click();
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
  await page.locator("main").getByRole("link", { name: "Reportes" }).click();
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Persona" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subproyecto" })).toBeVisible();
  await expect(page.getByText("Sin registros en el rango seleccionado.")).toBeVisible();
});

// Sidebar anclable/ocultable: desanclar la esconde tras la hamburguesa;
// volver a anclar la fija. La preferencia persiste (localStorage).
test("sidebar can be unpinned, reopened and pinned again", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await page.goto("/");
  await page.getByPlaceholder("Contraseña").fill("e2e-password");
  await page.getByRole("button", { name: "Entrar" }).click();
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await expect(sidebar).toBeVisible();
  // Desanclar: la sidebar se esconde y aparece la hamburguesa.
  await sidebar.getByRole("button", { name: "Desanclar menú" }).click();
  await expect(sidebar).not.toBeInViewport();
  const burger = page.getByRole("button", { name: "Abrir menú" });
  await expect(burger).toBeVisible();
  // Abrir como overlay y navegar (el overlay se cierra al navegar).
  await burger.click();
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("link", { name: "Exportar y sincronizar" }).click();
  await expect(page.getByRole("button", { name: "Incremental" })).toBeVisible();
  await expect(sidebar).not.toBeInViewport();
  // Re-anclar: abrir overlay y fijar.
  await burger.click();
  await sidebar.getByRole("button", { name: "Anclar menú" }).click();
  await expect(sidebar).toBeInViewport();
  await expect(burger).toBeHidden();
});

// La ruta vieja /reports redirige a la nueva ubicación bajo su BD.
test("legacy /reports redirects to /db/tiempos/reports", async ({ page }) => {
  await page.goto("/reports");
  await page.waitForURL("**/db/tiempos/reports");
  expect(page.url()).toContain("/db/tiempos/reports");
});
