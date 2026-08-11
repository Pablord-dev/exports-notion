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

test("Ayuda abre el mismo panel directo en Acerca de", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page);
  await page.getByRole("complementary", { name: "Navegación" })
            .getByRole("button", { name: "Menú de sesión" }).click();
  await page.getByRole("menuitem", { name: "Ayuda" }).click();

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await expect(panel.getByRole("heading", { name: "Acerca de" })).toBeVisible();
});
