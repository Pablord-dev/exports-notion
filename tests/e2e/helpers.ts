import { expect, type Page } from "@playwright/test";

/**
 * Login del entorno stub.
 *
 * Navega a /api/auth/stub-login, que sólo existe con E2E_STUBS=1 y escribe la
 * sesión directo: Playwright no puede completar el flujo real de Google. La ruta
 * redirige a /, así que al volver ya estamos en el menú.
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
  await page.goto("/api/auth/stub-login");
  // El stub redirige a / SIN ?bienvenida=1, y es correcto: el aviso de
  // bienvenida sólo debe salir tras un login real (el callback de Google es
  // quien agrega el parámetro). Los tests que sí esperan la bienvenida
  // reproducen esa vuelta a mano.
  if ((opts.welcome ?? "skip") === "expect") {
    await page.goto("/?bienvenida=1");
  }
  // Esperar el shell autenticado, no sólo la navegación: sin esto el helper
  // regresa antes de que la página termine de montar su rama con sesión, y un
  // test que interactúe de inmediato corre contra el "Cargando…".
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
  // Timeout ampliado: es una navegación real contra el único server que
  // comparten los 4 workers, y con la suite completa en paralelo pasa de los
  // 5s del default —falso rojo en dos tests del onboarding— aunque aislada
  // tarde ~1s. No enmascara nada: si el click no navegara, tampoco pasaría.
  await expect(page).toHaveURL(/\/db\/tiempos\/reports$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "BD Tiempos" })).toBeVisible({ timeout: 20_000 });
}
