import { expect, type Page } from "@playwright/test";

const STUB_PASSWORD = "e2e-password";

/**
 * Login del entorno stub.
 *
 * welcome: "skip" (default) siembra el estado del onboarding ANTES de cargar la
 * página, así el modal de bienvenida no aparece y no intercepta los clicks de
 * los tests que no van sobre el onboarding. "expect" lo deja aparecer.
 */
export async function login(page: Page, opts: { welcome?: "skip" | "expect" } = {}): Promise<void> {
  if ((opts.welcome ?? "skip") === "skip") {
    await page.addInitScript(() => {
      window.localStorage.setItem("onboarding-v1", JSON.stringify({ welcomeSeen: true }));
    });
  }
  await page.goto("/");
  await page.getByPlaceholder("Contraseña").fill(STUB_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Esperar el shell autenticado, no sólo el click: el POST /api/login es
  // asíncrono y sin esto el helper regresa antes de que la cookie exista —
  // un test que navegue de inmediato aterriza en "necesitas iniciar sesión".
  await expect(page.getByRole("complementary", { name: "Navegación" })).toBeAttached();
  if ((opts.welcome ?? "skip") === "skip") {
    await expect(page.getByTestId("welcome-modal")).toBeHidden();
  }
}

/**
 * Del menú a los reportes de BD Tiempos, esperando a que la navegación termine.
 *
 * El heading se pide por nivel 1: el matcheo de `name` es por substring, y en el
 * menú tanto el h1 "Reportes Notion" como el h3 "BD Tiempos" de la tarjeta
 * calzarían: la aserción pasaría sin haber navegado y el click siguiente
 * correría contra la página vieja.
 */
export async function gotoReports(page: Page): Promise<void> {
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await expect(page).toHaveURL(/\/db\/tiempos\/reports$/);
  await expect(page.getByRole("heading", { level: 1, name: "BD Tiempos" })).toBeVisible();
}
