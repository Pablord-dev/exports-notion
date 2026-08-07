import { test, expect, type Locator } from "@playwright/test";
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

  // La fila de controles no va pegada al textarea: sin un padding-top propio,
  // el único aire encima de las pills era el padding interno del textarea y las
  // dos cajas se tocaban (medido: 0px). Se exige separación, no un valor
  // concreto — el número es diseño y puede cambiar.
  const texto = (await page.getByPlaceholder("Escribe tu pregunta…").boundingBox())!;
  const pill = (await page.getByRole("combobox", { name: "Base de datos" }).boundingBox())!;
  expect(pill.y - (texto.y + texto.height)).toBeGreaterThan(0);
});

// Los botones que flotan sobre el contenido (☰ del shell, "?" del onboarding)
// tienen que ser opacos, y verse igual con el SO en claro y en oscuro.
//
// El tema es dark fijo por :root, pero mientras globals.css no declare un
// @custom-variant las utilidades `dark:` de shadcn son
// @media (prefers-color-scheme: dark): `dark:bg-input/30` y
// `dark:hover:bg-accent/50` se aplicaban SÓLO a quien tuviera el SO en oscuro
// —ganando por orden de hoja sobre el bg-card del callsite— y el contenido se
// veía pasar por debajo. Por eso el test compara las dos preferencias en vez de
// fijar colores: el bug era precisamente que no coincidían (alpha 0.3/0.5
// contra opaco), y con el default de Playwright (light) ninguna suite lo veía.
test("los botones flotantes son opacos e iguales con el SO claro y oscuro", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  const hide = page.getByRole("button", { name: "Ocultar menú" });
  const burger = page.getByRole("button", { name: "Abrir menú" });
  const help = page.locator('[data-tour="help-button"]');
  const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
  // Los botones llevan transition-all: medir justo al entrar el cursor devuelve
  // el color a media asta (visto: rgba(12,36,82,0.176), que parece alpha pero es
  // el fade). Se espera a que dos lecturas seguidas coincidan.
  const settledBg = async (l: Locator): Promise<string> => {
    let last = "";
    await expect.poll(async () => {
      const now = await l.evaluate(bg);
      const same = now === last && now !== "";
      last = now;
      return same;
    }, { timeout: 5_000, intervals: [100, 100, 100, 200] }).toBe(true);
    return last;
  };

  const porEsquema: Record<string, Record<string, string>> = {};
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Con la barra a la vista: el ghost de su header (sólo pinta al hover).
    await hide.hover();
    const ghostHover = await settledBg(hide);
    await hide.click();
    // Escondida: la hamburguesa, en reposo y al hover.
    const outline = await settledBg(burger);
    await burger.hover();
    const outlineHover = await settledBg(burger);
    // Alejar el cursor con pasos: un salto de un solo evento no cierra el peek.
    await page.mouse.move(900, 500, { steps: 10 });
    porEsquema[colorScheme] = { ghostHover, outline, outlineHover, help: await settledBg(help) };
    await burger.click(); // volver a anclar para que el próximo esquema arranque igual
  }

  // rgb(…) es opaco; rgba(…)/oklab(… / .3) llevan alpha.
  for (const [esquema, valores] of Object.entries(porEsquema)) {
    for (const [nombre, color] of Object.entries(valores)) {
      expect(color, `${nombre} con el SO en ${esquema}`).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    }
  }
  expect(porEsquema.dark).toEqual(porEsquema.light);
});

// El hover de un botón primario ACLARA el azul; no lo apaga. El default de
// shadcn es `hover:bg-primary/90`, que sobre un lienzo oscuro mezcla el azul con
// el fondo (rgba(15,64,239,.9) sobre #02091c = rgb(14,58,218)) y el hover se lee
// como apagado. Se afirma la dirección y no los valores —brightness y anillo son
// diseño y van a cambiar—: lo que no debe volver es el hover que oscurece, que
// es lo que reaparecería si alguien regenera button.tsx con la CLI de shadcn.
test("el hover de un botón primario aclara en vez de apagar", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  await page.goto("/asistente");
  const boton = page.getByRole("button", { name: "Nuevo chat" });
  const estilo = () => boton.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, filter: s.filter };
  });

  const reposo = await estilo();
  expect(reposo.filter).toBe("none");
  await boton.hover();
  // Poll: transition-all anima el filter, así que las primeras lecturas están a
  // media asta (brightness(1.03)…). Cualquier valor > 1 sirve: es la dirección.
  await expect.poll(async () => {
    const m = /brightness\(([\d.]+)\)/.exec((await estilo()).filter);
    return m ? Number(m[1]) > 1 : false;
  }).toBe(true);
  // Y el color de fondo no se compone con el lienzo: sigue siendo el azul pleno.
  expect((await estilo()).bg).toBe(reposo.bg);
});

// En el asistente el documento NO scrollea: sólo lo hacen la conversación y el
// historial, cada uno en su contenedor. La página pedía h-[100dvh] dentro del
// wrapper de AppShell, que le suma su --shell-top, así que medía 48px más que el
// viewport y el compositor quedaba mordido abajo (medido: scrollHeight 948 vs
// 900). Se prueba con historial y conversación sembrados en localStorage —el
// stub no tiene modelo, así que la única forma de ver la rama de conversación es
// abrir un chat guardado— y en dos alturas de ventana.
const chatsSembrados = Array.from({ length: 30 }, (_, i) => ({
  id: `c_seed_${i}`,
  title: `Conversación sembrada ${i} con un título suficientemente largo`,
  db: "tiempos",
  provider: "",
  messages: Array.from({ length: 12 }, (_, j) => ({
    role: j % 2 === 0 ? "user" : "assistant",
    content: `Mensaje ${j} del chat ${i}. `.repeat(20),
  })),
  createdAt: 1_750_000_000_000 + i,
  updatedAt: 1_750_000_000_000 + i,
}));

test("en el asistente sólo scrollean la conversación y el historial", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await page.addInitScript((seed) => {
    window.localStorage.setItem("asistente-chats-v1", JSON.stringify(seed));
  }, chatsSembrados);
  await login(page);

  const desborde = () => page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollHeight - d.clientHeight;
  });
  // Sube desde un nodo hasta el ancestro que realmente scrollea. Devuelve
  // "documento" si nadie de la cadena tiene overflow propio: eso es el bug.
  const scrollerDe = (texto: string) =>
    page.getByText(texto).first().evaluate((el) => {
      // Element y no HTMLElement: getByText puede aterrizar en un SVG.
      let node: Element | null = el;
      while (node && node !== document.documentElement) {
        const oy = getComputedStyle(node).overflowY;
        if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
          return { propio: true, scrollH: node.scrollHeight, clientH: node.clientHeight };
        }
        node = node.parentElement;
      }
      return { propio: false, scrollH: 0, clientH: 0 };
    });

  for (const height of [720, 560]) {
    await page.setViewportSize({ width: 1280, height });
    await page.goto("/asistente");

    expect(await desborde(), `documento con ${height}px de alto`).toBe(0);

    // El compositor entero cabe en la ventana (era lo que el desborde mordía).
    const composer = (await page.locator('[data-tour="chat-composer"]').boundingBox())!;
    expect(composer.y + composer.height, `fondo del compositor a ${height}px`).toBeLessThanOrEqual(height);

    // El historial scrollea por dentro, no arrastrando la página.
    const historial = await scrollerDe("Conversación sembrada 0");
    expect(historial.propio, `historial a ${height}px`).toBe(true);

    // Y la conversación también, con el documento todavía quieto.
    await page.getByText("Conversación sembrada 0").first().click();
    const convo = await scrollerDe("Mensaje 0 del chat 0");
    expect(convo.propio, `conversación a ${height}px`).toBe(true);
    expect(await desborde(), `documento con chat abierto a ${height}px`).toBe(0);
  }
});

// El header del asistente comparte el contenedor de las otras páginas
// (mx-auto max-w-[75rem] + px-6/sm:px-8). Se compara contra el de reportes en
// vez de contra números fijos: si algún día cambia el ancho del contenedor, el
// test sigue midiendo lo que importa —que las dos páginas se vean igual— y no
// se convierte en un número que hay que actualizar a mano. A 1920 el cap sí
// muerde (gap derecho 264 en vez de 32), que es justo el caso que se rompía:
// la acción pegada al canto de la ventana.
test("el header del asistente se alinea con el de reportes", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);

    await page.goto("/asistente");
    const chatTitle = (await page.getByRole("heading", { level: 1, name: "Asistente IA" }).boundingBox())!;
    const chatAction = (await page.getByRole("button", { name: "Nuevo chat" }).boundingBox())!;
    // El contenedor envuelve la página ENTERA, no sólo el header: capar sólo el
    // header dejaba el título entrando en x=520 mientras el panel de historial
    // seguía en x=256, y la página se leía partida. Se exige que el panel
    // arranque donde arranca el header.
    const header = (await page.locator("header").boundingBox())!;
    const historial = (await page.locator('[data-tour="chat-history"]').boundingBox())!;
    expect(historial.x, `panel de historial a ${size.width}px`).toBe(header.x);

    await page.goto("/db/tiempos/reports");
    const repTitle = (await page.getByRole("heading", { level: 1, name: "BD Tiempos" }).boundingBox())!;
    const repAction = (await page.getByRole("button", { name: "Sincronizar" }).boundingBox())!;

    expect(chatTitle.x, `título a ${size.width}px`).toBe(repTitle.x);
    expect(chatAction.x + chatAction.width, `acción a ${size.width}px`)
      .toBe(repAction.x + repAction.width);
  }
});

// La ruta vieja /reports redirige a la nueva ubicación bajo su BD.
test("legacy /reports redirects to /db/tiempos/reports", async ({ page }) => {
  await page.goto("/reports");
  await page.waitForURL("**/db/tiempos/reports");
  expect(page.url()).toContain("/db/tiempos/reports");
});

test("la ruta de stub-login sólo existe con E2E_STUBS", async ({ request }) => {
  // En esta suite la bandera está encendida, así que responde. El valor del test
  // es la aserción de arriba en CI y la de abajo como recordatorio: si algún día
  // esta ruta contesta en un entorno sin la bandera, es un agujero de auth.
  const r = await request.get("/api/auth/stub-login", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(process.env.E2E_STUBS).toBe("1");
});
