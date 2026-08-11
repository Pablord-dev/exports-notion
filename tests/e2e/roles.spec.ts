import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// El full reconstruye el snapshot entero, así que es de admin. El botón se ve
// igual (que exista es descubrible: dice que la función está y hay que pedir
// acceso), pero inerte y con un tooltip que explica por qué.
test("un viewer ve el botón Full deshabilitado y con explicación", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page, { role: "viewer" });
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await page.getByRole("button", { name: "Sincronizar" }).click();

  // El incremental sigue libre para cualquiera.
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeEnabled();

  const full = page.getByRole("button", { name: "Full", exact: true });
  await expect(full).toBeVisible();
  await expect(full).toHaveAttribute("aria-disabled", "true");

  // El tooltip es la única explicación del veto: si no abriera, el botón quedaría
  // gris y mudo. Es lo que se rompería si alguien cambia aria-disabled por disabled.
  await full.hover();
  await expect(page.getByText("Requiere permisos de administrador")).toBeVisible();
});

test("un admin puede usar el botón Full", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page, { role: "admin" });
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await page.getByRole("button", { name: "Sincronizar" }).click();

  const full = page.getByRole("button", { name: "Full", exact: true });
  await expect(full).toBeEnabled();
  await expect(full).not.toHaveAttribute("aria-disabled", "true");
});
