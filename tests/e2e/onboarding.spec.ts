import { test, expect, type Page } from "@playwright/test";
import { login, gotoReports } from "./helpers";

// Todo este archivo depende del password del entorno stub. test.skip() dentro de
// un hook aplica a cada test del archivo (llamarlo en el top-level lanzaría).
test.beforeEach(() => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
});

const popover = (page: Page) => page.getByTestId("tour-popover");
const progress = (page: Page) => page.getByTestId("tour-progress");

test("el botón ? corre el recorrido del menú paso por paso", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Menú principal" })).toBeVisible();

  await page.getByRole("button", { name: /Ayuda/ }).click();

  // Se verifica CADA contador, no sólo el último: si un paso se omitiera por
  // un data-tour faltante, la secuencia se rompe aquí.
  for (const [i, titulo] of [
    "Bienvenido a ExportNotion",
    "Asistente IA",
    "Tus bases de datos",
    "Navegación",
    "Este botón te trae de vuelta",
  ].entries()) {
    await expect(progress(page)).toHaveText(`${i + 1} / 5`);
    await expect(popover(page).getByRole("heading", { name: titulo })).toBeVisible();
    if (i < 4) await page.getByRole("button", { name: "Siguiente" }).click();
  }

  // El último paso del menú encadena en vez de terminar.
  await expect(page.getByRole("button", { name: "Continuar en BD Tiempos" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
});

test("Atrás retrocede y Esc cierra el recorrido", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Ayuda/ }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(progress(page)).toHaveText("2 / 5");
  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(progress(page)).toHaveText("1 / 5");
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
});

test("el paso de navegación abre la sidebar y la deja como estaba al salir", async ({ page }) => {
  await login(page);
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  // Desanclada, la sidebar está fuera de vista hasta que el tour la abra.
  await sidebar.getByRole("button", { name: "Desanclar menú" }).click();
  await expect(sidebar).not.toBeInViewport();

  await page.getByRole("button", { name: /Ayuda/ }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(progress(page)).toHaveText("4 / 5");
  await expect(sidebar).toBeInViewport();

  // El recorte tiene que terminar SOBRE la sidebar. La sidebar entra con una
  // transición de 200ms: si sólo se midiera el primer frame, el recorte se
  // quedaría en su posición de fuera de pantalla y la pantalla entera saldría
  // oscurecida, justo en el paso que explica la navegación.
  const spot = page.getByTestId("tour-spotlight");
  await expect.poll(async () => (await spot.boundingBox())?.x, { timeout: 2000 })
             .toBeGreaterThan(-8);
  const [box, aside] = [await spot.boundingBox(), await sidebar.boundingBox()];
  expect(Math.abs(box!.x - aside!.x)).toBeLessThanOrEqual(8);

  // Al salir del paso, el after la vuelve a cerrar.
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toBeInViewport();
});

test("el primer login de un navegador ofrece el recorrido en un modal", async ({ page }) => {
  await login(page, { welcome: "expect" });
  const modal = page.getByTestId("welcome-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Empezar" }).click();
  await expect(modal).toBeHidden();
  await expect(progress(page)).toHaveText("1 / 5");
});

test("el modal de bienvenida atrapa el foco: Tab no escapa al fondo", async ({ page }) => {
  await login(page, { welcome: "expect" });
  const modal = page.getByTestId("welcome-modal");
  const dismiss = modal.getByRole("button", { name: "Ahora no" });
  const start = modal.getByRole("button", { name: "Empezar" });

  // Al abrir, el foco parte en "Empezar" (último botón del modal).
  await expect(start).toBeFocused();
  // Tab desde el último botón recicla al primero, no al botón "?" de atrás.
  await page.keyboard.press("Tab");
  await expect(dismiss).toBeFocused();
  // Shift+Tab desde el primero recicla al último.
  await page.keyboard.press("Shift+Tab");
  await expect(start).toBeFocused();
});

test("“Ahora no” cierra el modal y deja el ? como vía de entrada", async ({ page }) => {
  await login(page, { welcome: "expect" });
  await page.getByTestId("welcome-modal").getByRole("button", { name: "Ahora no" }).click();
  await expect(page.getByTestId("welcome-modal")).toBeHidden();
  await expect(popover(page)).toBeHidden();
  await page.getByRole("button", { name: /Ayuda/ }).click();
  await expect(progress(page)).toHaveText("1 / 5");
});

test("el segundo login muestra la tira discreta, no el modal", async ({ page }) => {
  // Primer login: consume el modal (marca welcomeSeen en este navegador).
  await login(page, { welcome: "expect" });
  await page.getByTestId("welcome-modal").getByRole("button", { name: "Ahora no" }).click();
  // Cerrar sesión y volver a entrar en el mismo contexto (mismo localStorage).
  await page.getByRole("complementary", { name: "Navegación" })
            .getByRole("button", { name: "Cerrar sesión" }).click();
  await page.getByPlaceholder("Contraseña").fill("e2e-password");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByTestId("welcome-modal")).toBeHidden();
  const banner = page.getByTestId("welcome-banner");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Iniciar tutorial" }).click();
  await expect(progress(page)).toHaveText("1 / 5");
});

test("recargar con la sesión viva no vuelve a ofrecer el recorrido", async ({ page }) => {
  await login(page, { welcome: "expect" });
  await page.getByTestId("welcome-modal").getByRole("button", { name: "Ahora no" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Menú principal" })).toBeVisible();
  await expect(page.getByTestId("welcome-modal")).toBeHidden();
  await expect(page.getByTestId("welcome-banner")).toBeHidden();
});

test("el recorrido de reportes abre y cierra los modals por su cuenta", async ({ page }) => {
  await login(page);
  await gotoReports(page);

  await page.getByRole("button", { name: /Ayuda/ }).click();

  for (const [i, titulo] of [
    "El estado de la copia",
    "Filtros combinables",
    "Totales del corte",
    "Evolución de horas",
    "Horas por persona y por subproyecto",
  ].entries()) {
    await expect(progress(page)).toHaveText(`${i + 1} / 7`);
    await expect(popover(page).getByRole("heading", { name: titulo })).toBeVisible();
    await page.getByRole("button", { name: "Siguiente" }).click();
  }

  // Paso 6: el before abre el modal de exportación.
  await expect(progress(page)).toHaveText("6 / 7");
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();

  // Paso 7: el after del 6 cierra export y el before del 7 abre sync.
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(progress(page)).toHaveText("7 / 7");
  await expect(page.getByRole("button", { name: "Descargar" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeVisible();

  // El último paso de reportes encadena al asistente; salir con Esc corre el
  // after pendiente, así que no queda ningún modal abierto.
  await expect(page.getByRole("button", { name: "Continuar en el Asistente IA" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeHidden();
});

test("Esc en un paso que abrió un modal cierra ambos", async ({ page }) => {
  await login(page);
  await gotoReports(page);
  await page.getByRole("button", { name: /Ayuda/ }).click();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeHidden();
  // La página sigue usable: el click llega, así que no quedó el blocker del
  // tour comiéndose los eventos. Un heading visible no probaría nada — el
  // overlay tapa los clicks sin ocultar el contenido.
  await page.getByRole("button", { name: "Exportar" }).click();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();
});

test("el encadenado lleva del menú a reportes y de ahí al asistente", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Ayuda/ }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(progress(page)).toHaveText("5 / 5");

  await page.getByRole("button", { name: "Continuar en BD Tiempos" }).click();
  await expect(page).toHaveURL(/\/db\/tiempos\/reports$/);   // la URL queda limpia
  await expect(progress(page)).toHaveText("1 / 7");

  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(progress(page)).toHaveText("7 / 7");
  await page.getByRole("button", { name: "Continuar en el Asistente IA" }).click();
  await expect(page).toHaveURL(/\/asistente$/);
  await expect(progress(page)).toHaveText("1 / 4");
  // El modal que abrió el paso 7 de reportes no viaja con nosotros.
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeHidden();
});

test("recargar después del encadenado no re-arranca el recorrido", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /Ayuda/ }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Continuar en BD Tiempos" }).click();
  await expect(progress(page)).toHaveText("1 / 7");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "BD Tiempos" })).toBeVisible();
  await expect(popover(page)).toBeHidden();
});

test("el recorrido del asistente cubre compositor, selectores e historial", async ({ page }) => {
  await login(page);
  await page.getByRole("complementary", { name: "Navegación" })
            .getByRole("link", { name: "Asistente IA" }).click();
  await expect(page).toHaveURL(/\/asistente$/);

  await page.getByRole("button", { name: /Ayuda/ }).click();
  for (const [i, titulo] of [
    "Pregunta en lenguaje natural",
    "Base y modelo",
    "Tus conversaciones",
    "Cómo verificar una respuesta",
  ].entries()) {
    await expect(progress(page)).toHaveText(`${i + 1} / 4`);
    await expect(popover(page).getByRole("heading", { name: titulo })).toBeVisible();
    if (i < 3) await page.getByRole("button", { name: "Siguiente" }).click();
  }
  // Último guión de la cadena: no ofrece continuar en otra parte.
  await expect(page.getByRole("button", { name: /Continuar en/ })).toBeHidden();
  await page.getByRole("button", { name: "Terminar" }).click();
  await expect(popover(page)).toBeHidden();
});

test("Atrás desde el paso de sync regresa al de export", async ({ page }) => {
  await login(page);
  await gotoReports(page);
  await page.getByRole("button", { name: /Ayuda/ }).click();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeVisible();

  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(progress(page)).toHaveText("6 / 7");
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();
});
