import { test, expect } from "@playwright/test";
import { login } from "./helpers";

async function abrirConfiguracion(page: import("@playwright/test").Page) {
  await page.getByRole("complementary", { name: "Navegación" })
            .getByRole("button", { name: "Menú de sesión" }).click();
  await page.getByRole("menuitem", { name: "Configuración" }).click();
}

test("Configuración abre el panel en Cuenta y muestra el correo", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page);
  await abrirConfiguracion(page);

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Cuenta" })).toBeVisible();
  await expect(panel.getByText("e2e@hiuman.edu.mx")).toBeVisible();

  // Esc lo cierra, como el resto de los modals de la app.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("un admin ve la sección Usuarios y su propia fila va vedada", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page);
  await abrirConfiguracion(page);

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await panel.getByRole("button", { name: "Usuarios" }).click();
  await expect(panel.getByRole("heading", { name: "Usuarios" })).toBeVisible();

  // La fila propia existe pero está vedada, y el tooltip lo explica: es lo que se
  // rompería si alguien cambiara aria-disabled por disabled.
  // El nombre sale del correo y no de "Usuario E2E": la fila del admin la crea
  // stub-login con setUserRole, que no guarda nombre (sólo recordLogin lo hace).
  // exact para no capturar también la fila de e2e-viewer@.
  const propio = panel.getByRole("button", { name: "Borrar a e2e@hiuman.edu.mx", exact: true });
  await expect(propio).toHaveAttribute("aria-disabled", "true");
  await propio.hover();
  await expect(page.getByText("No podés borrar tu propio usuario")).toBeVisible();
});

test("un viewer no tiene la sección Usuarios", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page, { role: "viewer" });
  await abrirConfiguracion(page);

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await expect(panel.getByRole("heading", { name: "Cuenta" })).toBeVisible();
  // No se le veda con tooltip: no existe para él.
  await expect(panel.getByRole("button", { name: "Usuarios" })).toHaveCount(0);
});

test("Ayuda abre el mismo panel directo en Acerca de", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page);
  await page.getByRole("complementary", { name: "Navegación" })
            .getByRole("button", { name: "Menú de sesión" }).click();
  await page.getByRole("menuitem", { name: "Ayuda" }).click();

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await expect(panel.getByRole("heading", { name: "Acerca de" })).toBeVisible();
});
