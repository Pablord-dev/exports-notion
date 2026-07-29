import { test, expect, type Page } from "@playwright/test";

// Todo este archivo depende del password del entorno stub. test.skip() dentro de
// un hook aplica a cada test del archivo (llamarlo en el top-level lanzaría).
test.beforeEach(() => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
});

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Contraseña").fill("e2e-password");
  await page.getByRole("button", { name: "Entrar" }).click();
}

const popover = (page: Page) => page.getByTestId("tour-popover");
const progress = (page: Page) => page.getByTestId("tour-progress");

test("el botón ? corre el recorrido del menú paso por paso", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Bases de datos" })).toBeVisible();

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

  // El último paso ofrece encadenar; "Terminar" cierra el recorrido.
  await page.getByRole("button", { name: "Terminar" }).click();
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

  // Al salir del paso, el after la vuelve a cerrar.
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toBeInViewport();
});
