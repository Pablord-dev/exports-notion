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

// ?modal=export abre el modal de exportación al cargar la página. Ya no hay
// botón en el menú que lo use, pero la URL sigue siendo compartible y sin
// prueba se rompería en silencio.
test("?modal=export opens the export modal on load", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  await page.goto("/db/tiempos/reports?modal=export");
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();
});

// Sidebar anclable/ocultable: ocultarla la esconde tras la hamburguesa; el
// cursor encima la hace asomar flotando y sale sola; la hamburguesa la vuelve a
// fijar. La preferencia persiste (localStorage).
test("sidebar peeks on hover, hides on leave and can be pinned again", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await expect(sidebar).toBeVisible();
  // Ocultar desde su header: la sidebar se esconde y aparece la hamburguesa.
  await sidebar.getByRole("button", { name: "Ocultar menú" }).click();
  await expect(sidebar).not.toBeInViewport();
  const burger = page.getByRole("button", { name: "Abrir menú" });
  await expect(burger).toBeVisible();
  // Hover: asoma flotando y SIN backdrop (z-40) — lo de atrás sigue usable.
  await burger.hover();
  await expect(sidebar).toBeInViewport();
  await expect(page.locator("div.fixed.inset-0.z-40")).toHaveCount(0);
  // Flotante de verdad: pegado al canto izquierdo y arrancando un aire FIJO
  // (PANEL_GAP = 12px) debajo de la hamburguesa, que por eso sigue visible y
  // clickeable con la barra asomada.
  await expect(burger).toBeVisible();
  // poll y no una medición seca: ocultar/anclar anima top y bottom, así que el
  // gap se comprueba cuando la transición terminó, no en un frame intermedio.
  await expect.poll(async () => {
    const [panel, btn] = [await sidebar.boundingBox(), await burger.boundingBox()];
    return { gap: panel!.y - (btn!.y + btn!.height), x: panel!.x };
  }).toEqual({ gap: 12, x: 0 });
  // Alejar el cursor la esconde sola, sin haber clickeado nada.
  await page.mouse.move(900, 400);
  await expect(sidebar).not.toBeInViewport();
  // Navegar desde la barra asomada la esconde y la deja desanclada:
  // la BD vive dentro del grupo desplegable "Bases de datos" (abierto por default).
  await burger.hover();
  await expect(sidebar.getByRole("button", { name: "Bases de datos" })).toBeVisible();
  await sidebar.getByRole("link", { name: "BD Tiempos" }).click();
  await expect(page.getByRole("button", { name: "Sincronizar" })).toBeVisible();
  await expect(sidebar).not.toBeInViewport();
  await expect(burger).toBeVisible();
  // Re-anclar: el click en la hamburguesa, que el asomo deja siempre visible.
  await burger.click();
  await expect(sidebar).toBeInViewport();
  await expect(burger).toBeHidden();
});

// El click en la hamburguesa fija la barra de una: con el hover ya mostrándola,
// un click sólo puede querer decir "quédate". (En móvil abre el overlay, pero
// este proyecto de Playwright es desktop.)
test("clicking the hamburger pins the sidebar", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await sidebar.getByRole("button", { name: "Ocultar menú" }).click();
  const burger = page.getByRole("button", { name: "Abrir menú" });
  await expect(burger).toBeVisible();
  await burger.click();
  await expect(sidebar).toBeInViewport();
  await expect(burger).toBeHidden();
  // Fijada de verdad: sobrevive a una navegación, no es un asomo.
  await sidebar.getByRole("link", { name: "BD Tiempos" }).click();
  await expect(page.getByRole("button", { name: "Sincronizar" })).toBeVisible();
  await expect(sidebar).toBeInViewport();
});

// Los botones de icono explican qué hacen con un tooltip propio (Radix), no con
// el `title` del navegador: aparece en ~300ms, es tematizable y se lee con
// lector de pantalla. El aria-label sigue siendo el nombre accesible.
test("los botones de icono muestran tooltip al pasar el cursor", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await sidebar.getByRole("button", { name: "Cerrar sesión" }).hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toHaveText("Cerrar sesión");
  // Superficie del sistema, no el bg-primary del default de shadcn.
  await expect(tip).toHaveCSS("background-color", "rgb(12, 36, 82)");
  // Se va al alejar el cursor: si quedara pegado taparía la navegación.
  // Con pasos intermedios a propósito: Radix decide el cierre siguiendo el
  // pointermove (mantiene abierto el contenido hoverable), y un salto de un
  // solo evento —lo que hace mouse.move sin `steps`— no lo cierra. Un cursor
  // real siempre produce el recorrido.
  await page.mouse.move(900, 400, { steps: 10 });
  await expect(tip).toBeHidden();
});

// La barra entra deslizándose, no de golpe. Regresión de un bug que no se veía
// en ninguna aserción: en Tailwind v4 `-translate-x-full` compila a la propiedad
// CSS `translate`, así que una transición que listaba `transform` se generaba
// igual pero no animaba nada (medido por frame: -256 → 0, sin intermedios).
test("la sidebar entra deslizándose, no de golpe", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await sidebar.getByRole("button", { name: "Ocultar menú" }).click();
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole("button", { name: "Abrir menú" }).hover();
  // 60 frames (~1s) cubren el retardo de intención del asomo más la animación.
  const xs = await page.evaluate(async () => {
    const el = document.querySelector('aside[aria-label="Navegación"]')!;
    const out: number[] = [];
    for (let i = 0; i < 60; i++) {
      out.push(Math.round(el.getBoundingClientRect().x));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  // Sin transición efectiva todos los valores serían -256 (fuera) o 0 (dentro).
  expect(xs.some((x) => x > -256 && x < 0)).toBe(true);
});

// Anclar la barra sólo corre el contenido a la derecha. Con el `lg:pt-0` del
// wrapper también lo subía 48px: un salto vertical en una acción que es
// puramente horizontal.
test("anclar la sidebar corre el contenido sin moverlo verticalmente", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  const heading = page.getByRole("heading", { level: 1, name: "Menú principal" });
  await sidebar.getByRole("button", { name: "Ocultar menú" }).click();
  await expect(sidebar).not.toBeInViewport();
  const before = await heading.boundingBox();
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await expect(sidebar).toBeInViewport();
  // El padding del contenido se anima: poll hasta que el corrimiento termine.
  await expect.poll(async () => (await heading.boundingBox())!.x)
             .toBeGreaterThan(before!.x);
  expect((await heading.boundingBox())!.y).toBe(before!.y);
});

// El aire entre la hamburguesa y el panel es fijo en cualquier viewport, no
// sólo en desktop ancho. Debajo de lg la barra se comporta como overlay aunque
// `pinned` siga true, y con la geometría a ras atada a `pinned` el panel se
// pegaba a y=0 y tapaba el botón (medido: gap -52 en 900x600).
test("el panel flotante deja el mismo aire bajo la hamburguesa debajo de lg", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await page.setViewportSize({ width: 900, height: 600 });
  await login(page);
  // Debajo de lg no hay control de anclaje (anclar no aplica): la barra ya está
  // escondida tras la hamburguesa sin tocar nada.
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  const burger = page.getByRole("button", { name: "Abrir menú" });
  await expect(burger).toBeVisible();
  await burger.hover();
  await expect(sidebar).toBeInViewport();
  await expect.poll(async () => {
    const [panel, btn] = [await sidebar.boundingBox(), await burger.boundingBox()];
    return panel!.y - (btn!.y + btn!.height);
  }).toBe(12);
  await expect(burger).toBeVisible();
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
