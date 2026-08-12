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
  const propio = panel.getByRole("button", { name: "Quitar acceso a e2e@hiuman.edu.mx", exact: true });
  await expect(propio).toHaveAttribute("aria-disabled", "true");
  await propio.hover();
  await expect(page.getByText("No podés quitarte el acceso a vos mismo")).toBeVisible();
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

// El motivo de todo el mecanismo de bloqueo: la sesión es una cookie sellada de
// 7 días y el server no lleva registro de cuáles existen, así que sin esto
// quitarle el acceso a alguien no le hacía nada hasta que venciera.
// Serial y con identidad propia: las dos pruebas bloquean al mismo usuario, y en
// paralelo una restauraría el acceso mientras la otra lo está comprobando.
test.describe.serial("quitar el acceso cierra la sesión", () => {
  const FUERA = "e2e-descartable@hiuman.edu.mx";

  async function quitarleElAcceso(page: import("@playwright/test").Page) {
    await login(page);
    await abrirConfiguracion(page);
    const panel = page.getByRole("dialog", { name: "Configuración" });
    await panel.getByRole("button", { name: "Usuarios" }).click();
    await panel.getByRole("button", { name: `Quitar acceso a ${FUERA}`, exact: true }).click();
    await panel.getByRole("button", { name: "Quitar acceso", exact: true }).click();
    // Su fila, no el encabezado: la sección se dibuja siempre (abajo tiene el
    // campo para bloquear a alguien que todavía no entró) y otro test en paralelo
    // puede tener a otra persona en la misma lista.
    await expect(panel.getByRole("button", { name: `Restaurar acceso a ${FUERA}` })).toBeVisible();
  }

  // Si el test se cae a mitad, el bloqueo quedaría puesto y el login de la
  // siguiente corrida (o del reintento en CI) fallaría antes de empezar.
  test.afterEach(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto("/api/auth/stub-login?role=admin");
    await p.request.delete(`/api/admin/blocked?email=${encodeURIComponent(FUERA)}`);
    await ctx.close();
  });

  test("quien perdió el acceso queda afuera al recargar", async ({ browser }) => {
    test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
    const ctxFuera = await browser.newContext();
    const ctxAdmin = await browser.newContext();
    const suyo = await ctxFuera.newPage();
    const admin = await ctxAdmin.newPage();

    await login(suyo, { role: "descartable" });
    await expect(suyo.getByRole("complementary", { name: "Navegación" })).toBeVisible();

    await quitarleElAcceso(admin);

    // Su cookie sigue siendo válida y bien firmada; lo que cambió es que el
    // server ya no la acepta.
    await suyo.reload();
    await expect(suyo.getByRole("link", { name: "Continuar con Google" })).toBeVisible();

    // Y restaurarlo lo deja entrar de nuevo. Se mira que desaparezca la FILA y no
    // el encabezado: la sección se dibuja siempre, porque abajo tiene el campo
    // para bloquear a alguien que todavía no entró.
    const panel = admin.getByRole("dialog", { name: "Configuración" });
    await panel.getByRole("button", { name: `Restaurar acceso a ${FUERA}` }).click();
    await expect(panel.getByRole("button", { name: `Restaurar acceso a ${FUERA}` })).toHaveCount(0);
    await login(suyo, { role: "descartable" });
    await expect(suyo.getByRole("complementary", { name: "Navegación" })).toBeVisible();

    await ctxFuera.close();
    await ctxAdmin.close();
  });

  test("y sin tocar nada, la app lo expulsa sola en un minuto", async ({ browser }) => {
    test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
    const ctxFuera = await browser.newContext();
    const ctxAdmin = await browser.newContext();
    const suyo = await ctxFuera.newPage();
    const admin = await ctxAdmin.newPage();

    // Reloj falso para no esperar 60s de verdad. Se instala antes de navegar:
    // después, los timers ya creados no quedan bajo su control.
    await suyo.clock.install();
    await login(suyo, { role: "descartable" });
    await expect(suyo.getByRole("complementary", { name: "Navegación" })).toBeVisible();

    await quitarleElAcceso(admin);

    // Nadie toca esa pestaña: es el poll del shell el que la saca.
    await suyo.clock.fastForward("01:05");
    await expect(suyo.getByRole("link", { name: "Continuar con Google" })).toBeVisible();

    await ctxFuera.close();
    await ctxAdmin.close();
  });
});

// Cerrarle la puerta a alguien ANTES de su primer ingreso: hasta acá la única vía
// era quitarle el acceso a una fila ya existente.
test("un admin puede bloquear un correo que nunca entró", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  // Correo propio de este test: no lo usa ningún login, así que bloquearlo no
  // tumba a nadie que corra en paralelo contra el memory-store singleton.
  const NUNCA = "nunca-entro-e2e@hiuman.edu.mx";

  await login(page);
  await abrirConfiguracion(page);
  const panel = page.getByRole("dialog", { name: "Configuración" });
  await panel.getByRole("button", { name: "Usuarios" }).click();

  const campo = panel.getByRole("textbox", { name: "Correos a bloquear" });
  await campo.fill(NUNCA);
  await panel.getByRole("button", { name: "Bloquear" }).click();
  await expect(panel.getByRole("heading", { name: "Sin acceso" })).toBeVisible();
  await expect(panel.getByText(NUNCA)).toBeVisible();

  // Un typo no escribe nada y lo dice: la lista decide quién entra y nadie
  // revisa después qué quedó anotado ahí.
  await campo.fill("sin-arroba");
  await panel.getByRole("button", { name: "Bloquear" }).click();
  await expect(panel.getByText("No parecen correos: sin-arroba")).toBeVisible();

  // Restaurarlo deja el store como estaba para la próxima corrida.
  await panel.getByRole("button", { name: `Restaurar acceso a ${NUNCA}` }).click();
  await expect(panel.getByText(NUNCA)).toHaveCount(0);
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
