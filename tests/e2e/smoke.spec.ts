import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("login screen renders and rejects wrong password", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Contraseña")).toBeVisible();
  await page.getByPlaceholder("Contraseña").fill("incorrecto");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/Contraseña incorrecta|Demasiados intentos/)).toBeVisible();
});

// Sólo en modo stub (default): el password del entorno E2E es conocido.
// Con E2E_REAL=1 se salta — no conocemos el password real.
test("login shows main menu and sync/export modals work", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  // Menú principal: tarjeta de la BD + sidebar anclada (default desktop).
  await expect(page.getByRole("heading", { name: "Menú principal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BD Tiempos" })).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  // La página de la BD es la de reportes; sync y export viven en modals.
  await sidebar.getByRole("link", { name: "BD Tiempos" }).click();
  await expect(page.getByRole("heading", { name: "Evolución de horas" })).toBeVisible();
  // Modal de sincronización: botones del viejo dashboard; Esc lo cierra.
  await page.getByRole("button", { name: "Sincronizar" }).click();
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Full" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Full" })).toBeHidden();
  // Modal de exportación: click fuera (backdrop) regresa al reporte.
  // Posición fuera de la sidebar anclada (0–256px) y del cuadro centrado del modal.
  await page.getByRole("button", { name: "Exportar" }).click();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();
  await page.locator("div.fixed.inset-0").click({ position: { x: 300, y: 300 } });
  await expect(page.getByRole("button", { name: "Descargar" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Evolución de horas" })).toBeVisible();
});

// Reportes (SB-13/14): con el store en memoria vacío la página debe cargar
// con filtros visibles y estados vacíos — nunca romper.
test("reports page renders filters and empty state", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  // "Ver reportes de BD Tiempos" es el link primario de la tarjeta de la BD.
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await expect(page.getByRole("heading", { name: "Evolución de horas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Persona" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subproyecto" })).toBeVisible();
  await expect(page.getByText("Sin registros en el rango seleccionado.")).toBeVisible();
});

// Sidebar anclable/ocultable: desanclar la esconde tras la hamburguesa;
// volver a anclar la fija. La preferencia persiste (localStorage).
test("sidebar can be unpinned, reopened and pinned again", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await expect(sidebar).toBeVisible();
  // Desanclar: la sidebar se esconde y aparece la hamburguesa.
  await sidebar.getByRole("button", { name: "Desanclar menú" }).click();
  await expect(sidebar).not.toBeInViewport();
  const burger = page.getByRole("button", { name: "Abrir menú" });
  await expect(burger).toBeVisible();
  // Abrir como overlay y navegar (el overlay se cierra al navegar):
  // la BD vive dentro del grupo desplegable "Bases de datos" (abierto por default).
  await burger.click();
  await expect(sidebar).toBeInViewport();
  await expect(sidebar.getByRole("button", { name: "Bases de datos" })).toBeVisible();
  await sidebar.getByRole("link", { name: "BD Tiempos" }).click();
  await expect(page.getByRole("button", { name: "Sincronizar" })).toBeVisible();
  await expect(sidebar).not.toBeInViewport();
  // Re-anclar: abrir overlay y fijar.
  await burger.click();
  await sidebar.getByRole("button", { name: "Anclar menú" }).click();
  await expect(sidebar).toBeInViewport();
  await expect(burger).toBeHidden();
});

// Asistente IA (chat): la página carga tras login, con encabezado, selector de
// modelo y caja de mensaje. No se envía nada (el LLM real no corre en E2E).
test("chat page renders composer and model selector", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  // "Asistente IA" es entrada top-level del sidebar → /asistente.
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await sidebar.getByRole("link", { name: "Asistente IA" }).click();
  await expect(page).toHaveURL(/\/asistente$/);
  await expect(page.getByRole("heading", { name: "Asistente IA" })).toBeVisible();
  await expect(page.getByPlaceholder("Escribe tu pregunta…")).toBeVisible();
  // Selects de shadcn/Radix dentro del cuadro de texto (rol combobox).
  await expect(page.getByRole("combobox", { name: "Modelo" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Base de datos" })).toBeVisible();
});

// La ruta vieja /reports redirige a la nueva ubicación bajo su BD.
test("legacy /reports redirects to /db/tiempos/reports", async ({ page }) => {
  await page.goto("/reports");
  await page.waitForURL("**/db/tiempos/reports");
  expect(page.url()).toContain("/db/tiempos/reports");
});
