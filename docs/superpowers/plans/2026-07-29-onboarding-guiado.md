# Onboarding guiado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un recorrido guiado con spotlight por página, botón "?" permanente y modal de bienvenida tras el primer inicio de sesión de cada navegador.

**Architecture:** Motor propio en `src/lib/tour/` (tipos + geometría pura + storage + guiones como datos) y componentes en `src/app/components/tour/`. El tour entra a cada página **por props de `AppShell`** — no por contexto — porque `AppShell` es hijo de la página y un contexto declarado en el shell no alcanzaría al componente que tiene el `setModal`. El spotlight es un `<div>` sobre el rect del ancla con una `box-shadow` gigante.

**Tech Stack:** Next 16 (App Router, client components), React 19.2, TypeScript strict, Tailwind 4 (tokens en `src/app/globals.css`), Vitest (entorno `node`), Playwright.

Spec: [`docs/superpowers/specs/2026-07-29-onboarding-guiado-design.md`](../specs/2026-07-29-onboarding-guiado-design.md)

## Global Constraints

- **Cero dependencias nuevas.** Nada de `driver.js`, `react-joyride`, `floating-ui`. Si algo parece necesitarlas, es señal de que el paso está mal diseñado.
- **Toda la copy en español**, con acentos correctos. Tono del proyecto: directo, sin signos de exclamación de más.
- **Sólo tokens del brandbook** para colores: `bg-surface`, `border-border`, `text-fg`, `text-muted`, `text-sky`, `bg-blue`, `bg-dark-blue`, `text-danger`. Únicos literales permitidos: `rgba(5, 23, 88, 0.8)` en la `box-shadow` del recorte (equivale a `bg-dark-blue/80`, el mismo tono de los modals existentes) y el `9999px` de esparcimiento.
- **`font-display` en títulos**, `font-sans` (default) en cuerpo, como el resto de la app.
- **Path alias `@/*` → `src/*`.**
- **Vitest corre en entorno `node`** (`vitest.config.ts`), así que **no hay tests de componentes React**: sólo funciones puras en `tests/unit/` y comportamiento en Playwright. No instalar jsdom ni Testing Library.
- **Nombres de ancla** en kebab-case con prefijo de superficie: `menu-*`, `reports-*`, `chat-*`, `shell-*`, más `help-button`. Se declaran como `data-tour="<ancla>"`.
- **El tour nunca ejecuta acciones destructivas**: sólo abre y cierra modals y la sidebar. Jamás dispara "Refrescar incremental", "Full" ni "Descargar".
- **Commits**: conventional en español, imperativo, asunto ≤72 caracteres (ver `CONTRIBUTING.md`). Un commit por tarea.
- **Gate antes de cerrar cada tarea**: `npm test && npx tsc --noEmit && npm run lint`. Además `npm run test:e2e` en las tareas que tocan UI (todas de la 5 en adelante). Mostrar la salida real, no un resumen.
- **Rama**: `feat/onboarding-guiado` (ya creada, con el spec commiteado).

## Mapa de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/lib/tour/types.ts` | `TourId`, `TourActionId`, `TourStep`, `TourScript`. Sin runtime. | 1 |
| `src/lib/tour/geometry.ts` | Puro: rect del ancla + viewport → posición del globo. Sin DOM. | 1 |
| `src/lib/tour/storage.ts` | `localStorage` `"onboarding-v1"`: visto/no visto la bienvenida. | 2 |
| `src/lib/tour/scripts.ts` | Los tres guiones como datos + registro `TourId → TourScript`. | 3 |
| `src/app/components/tour/tour-popover.tsx` | El globo: título, cuerpo, contador, botones. Presentacional. | 4 |
| `src/app/components/tour/tour-layer.tsx` | Motor: paso vigente, acciones, teclado, medición, "?" y bienvenida. | 5, 6, 9 |
| `src/app/components/tour/welcome.tsx` | Modal de bienvenida y tira discreta. | 6 |
| `src/app/components/app-shell.tsx` | Acepta `tour`/`justLoggedIn`, monta `TourLayer`, ancla `shell-sidebar`. | 5 |
| `src/app/page.tsx` | Anclas del menú, `justLoggedIn`, binding del tour `menu`. | 5, 6 |
| `src/app/db/tiempos/reports/page.tsx` | Anclas de reportes, acciones de modals, binding `reports`. | 7 |
| `src/app/asistente/page.tsx` | Anclas del chat, binding `asistente`. | 8 |
| `tests/unit/tour-geometry.test.ts` | Geometría. | 1 |
| `tests/unit/tour-storage.test.ts` | Storage. | 2 |
| `tests/unit/tour-scripts.test.ts` | Invariantes de los guiones. | 3 |
| `tests/e2e/helpers.ts` | `login(page, opts)` compartido, con control de la bienvenida. | 6 |
| `tests/e2e/onboarding.spec.ts` | Recorridos completos, encadenado, disparo. | 5–9 |
| `tests/e2e/smoke.spec.ts` | Migrar al helper de login (la bienvenida taparía sus clicks). | 6 |

---

### Task 1: Tipos y geometría del globo

Base pura y sin DOM: decide dónde va el globo dado el rect del ancla y el viewport. Es la única parte con aritmética delicada, y por eso la primera.

**Files:**
- Create: `src/lib/tour/types.ts`
- Create: `src/lib/tour/geometry.ts`
- Test: `tests/unit/tour-geometry.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type TourId = "menu" | "reports" | "asistente"`
  - `type TourActionId = "openSidebar" | "closeSidebar" | "openExportModal" | "openSyncModal" | "closeModal"`
  - `interface TourStep { anchor?: string; title: string; body: string; side?: Side; before?: TourActionId; after?: TourActionId }`
  - `interface TourScript { id: TourId; steps: TourStep[]; next?: { href: string; tour: TourId; label: string } }`
  - `type Side = "top" | "bottom" | "left" | "right"`
  - `interface Rect { top: number; left: number; width: number; height: number }`
  - `interface Viewport { width: number; height: number }`
  - `interface Placement { top: number; left: number; side: Side | "center"; mobile: boolean }`
  - `function popoverPlacement(anchor: Rect | null, vp: Viewport, preferred?: Side): Placement`
  - Constantes exportadas: `POPOVER_W = 320`, `POPOVER_H = 200`, `GAP = 12`, `MARGIN = 8`, `MOBILE_MAX = 640`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/tour-geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  popoverPlacement, POPOVER_W, POPOVER_H, GAP, MARGIN,
  type Rect, type Viewport,
} from "@/lib/tour/geometry";

const vp: Viewport = { width: 1280, height: 800 };
const rect = (top: number, left: number, width = 200, height = 60): Rect => ({ top, left, width, height });

describe("popoverPlacement", () => {
  it("sin ancla centra el globo en el viewport", () => {
    const p = popoverPlacement(null, vp);
    expect(p.side).toBe("center");
    expect(p.mobile).toBe(false);
    expect(p.left).toBe((1280 - POPOVER_W) / 2);
    expect(p.top).toBe((800 - POPOVER_H) / 2);
  });

  it("por default va debajo del ancla cuando cabe", () => {
    const p = popoverPlacement(rect(100, 500), vp);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(100 + 60 + GAP);
    // alineado al borde izquierdo del ancla
    expect(p.left).toBe(500);
  });

  it("voltea a arriba cuando abajo no cabe", () => {
    // ancla al pie: 700 + 60 + 12 + 200 = 972 > 800 - 8
    const p = popoverPlacement(rect(700, 500), vp);
    expect(p.side).toBe("top");
    expect(p.top).toBe(700 - GAP - POPOVER_H);
  });

  it("si ningún lado vertical cabe, conserva el preferido y acota al viewport", () => {
    const tall = { width: 1280, height: 240 };
    const p = popoverPlacement(rect(90, 500), tall);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(240 - POPOVER_H - MARGIN);
    expect(p.top).toBeGreaterThanOrEqual(MARGIN);
  });

  it("side=right coloca a la derecha del ancla y voltea a la izquierda si no cabe", () => {
    const cabe = popoverPlacement(rect(300, 100), vp, "right");
    expect(cabe.side).toBe("right");
    expect(cabe.left).toBe(100 + 200 + GAP);

    const noCabe = popoverPlacement(rect(300, 1100), vp, "right");
    expect(noCabe.side).toBe("left");
    expect(noCabe.left).toBe(1100 - GAP - POPOVER_W);
  });

  it("acota horizontalmente cuando el ancla está pegada al borde derecho", () => {
    const p = popoverPlacement(rect(100, 1240, 40, 40), vp);
    expect(p.left).toBe(1280 - POPOVER_W - MARGIN);
  });

  it("acota horizontalmente cuando el ancla está pegada al borde izquierdo", () => {
    const p = popoverPlacement(rect(100, -30), vp);
    expect(p.left).toBe(MARGIN);
  });

  it("en móvil manda el globo al pie a ancho completo", () => {
    const p = popoverPlacement(rect(100, 20), { width: 390, height: 844 });
    expect(p.mobile).toBe(true);
    expect(p.top).toBe(844 - POPOVER_H - MARGIN);
    expect(p.left).toBe(MARGIN);
  });

  it("en móvil ignora el ancla ausente y sigue al pie", () => {
    const p = popoverPlacement(null, { width: 390, height: 844 });
    expect(p.mobile).toBe(true);
    expect(p.top).toBe(844 - POPOVER_H - MARGIN);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/tour-geometry.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/tour/geometry"`.

- [ ] **Step 3: Escribir los tipos**

Crear `src/lib/tour/types.ts`:

```ts
// Contrato del recorrido guiado (onboarding). Sin runtime: sólo tipos.
// Los guiones viven en scripts.ts; el motor en app/components/tour/.

/** Un guión por superficie autenticada. */
export type TourId = "menu" | "reports" | "asistente";

/**
 * Acciones que un paso puede pedirle a su página. Nunca destructivas: sólo
 * abren y cierran cosas. La página decide cómo se ejecutan (pasa handlers a
 * AppShell); el guión sólo las nombra.
 */
export type TourActionId =
  | "openSidebar"
  | "closeSidebar"
  | "openExportModal"
  | "openSyncModal"
  | "closeModal";

export type Side = "top" | "bottom" | "left" | "right";

export interface TourStep {
  /** Elemento con data-tour="<anchor>". Ausente = globo centrado, sin recorte. */
  anchor?: string;
  title: string;
  /** Texto plano: no se renderiza markdown (no arrastramos react-markdown aquí). */
  body: string;
  /** Lado preferido del globo; geometry lo voltea si no cabe. Default: "bottom". */
  side?: Side;
  /** Se ejecuta al ENTRAR al paso, antes de buscar el ancla. */
  before?: TourActionId;
  /**
   * Se ejecuta al SALIR del paso en cualquier dirección — avanzar, retroceder,
   * saltar, Esc o terminar. Es la garantía de que un tour abortado no deja un
   * modal abierto.
   */
  after?: TourActionId;
}

export interface TourScript {
  id: TourId;
  steps: TourStep[];
  /** Encadenado opt-in: botón extra en el último paso. */
  next?: { href: string; tour: TourId; label: string };
}
```

- [ ] **Step 4: Escribir la geometría**

Crear `src/lib/tour/geometry.ts`:

```ts
// Posición del globo del tour: función pura sobre rects, sin tocar el DOM.
// El motor mide con getBoundingClientRect y le pasa el resultado aquí, así
// esta aritmética —la única delicada del tour— se prueba en Vitest (que corre
// en entorno "node", sin DOM).
import type { Side } from "./types";

export type { Side };

export interface Rect { top: number; left: number; width: number; height: number }
export interface Viewport { width: number; height: number }

export interface Placement {
  top: number;
  left: number;
  side: Side | "center";
  /** true = viewport angosto: el globo va al pie, a ancho completo. */
  mobile: boolean;
}

/** Ancho fijo del globo en desktop. */
export const POPOVER_W = 320;
/** Alto estimado del globo: sólo se usa para decidir el lado y acotar. */
export const POPOVER_H = 200;
/** Aire entre el ancla y el globo. */
export const GAP = 12;
/** Margen mínimo contra los bordes del viewport. */
export const MARGIN = 8;
/** Por debajo de este ancho se usa el layout móvil. */
export const MOBILE_MAX = 640;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function popoverPlacement(
  anchor: Rect | null,
  vp: Viewport,
  preferred: Side = "bottom",
): Placement {
  // Móvil: el ancla puede quedar en cualquier parte; el globo siempre al pie.
  if (vp.width < MOBILE_MAX) {
    return { top: vp.height - POPOVER_H - MARGIN, left: MARGIN, side: "bottom", mobile: true };
  }

  if (!anchor) {
    return {
      top: (vp.height - POPOVER_H) / 2,
      left: (vp.width - POPOVER_W) / 2,
      side: "center",
      mobile: false,
    };
  }

  const maxTop = vp.height - POPOVER_H - MARGIN;
  const maxLeft = vp.width - POPOVER_W - MARGIN;
  const vertical = preferred === "top" || preferred === "bottom";

  if (vertical) {
    const below = anchor.top + anchor.height + GAP;
    const above = anchor.top - GAP - POPOVER_H;
    const fitsBelow = below <= maxTop;
    const fitsAbove = above >= MARGIN;
    // Se voltea sólo si el preferido no cabe y el opuesto sí; si ninguno cabe,
    // conserva el preferido y se acota (mejor tapar algo que salirse).
    const side: Side = preferred === "bottom"
      ? (fitsBelow || !fitsAbove ? "bottom" : "top")
      : (fitsAbove || !fitsBelow ? "top" : "bottom");
    return {
      top: clamp(side === "bottom" ? below : above, MARGIN, Math.max(MARGIN, maxTop)),
      left: clamp(anchor.left, MARGIN, Math.max(MARGIN, maxLeft)),
      side,
      mobile: false,
    };
  }

  const right = anchor.left + anchor.width + GAP;
  const left = anchor.left - GAP - POPOVER_W;
  const fitsRight = right <= maxLeft;
  const fitsLeft = left >= MARGIN;
  const side: Side = preferred === "right"
    ? (fitsRight || !fitsLeft ? "right" : "left")
    : (fitsLeft || !fitsRight ? "left" : "right");
  return {
    top: clamp(anchor.top, MARGIN, Math.max(MARGIN, maxTop)),
    left: clamp(side === "right" ? right : left, MARGIN, Math.max(MARGIN, maxLeft)),
    side,
    mobile: false,
  };
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/tour-geometry.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Gate y commit**

```bash
npm test && npx tsc --noEmit && npm run lint
git add src/lib/tour/types.ts src/lib/tour/geometry.ts tests/unit/tour-geometry.test.ts
git commit -m "feat(tour): contrato de pasos y geometría del globo"
```

---

### Task 2: Estado persistido de la bienvenida

**Files:**
- Create: `src/lib/tour/storage.ts`
- Test: `tests/unit/tour-storage.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `function hasSeenWelcome(): boolean`, `function markWelcomeSeen(): void`, `const ONBOARDING_KEY = "onboarding-v1"`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/tour-storage.test.ts` (mismo patrón de `fakeStorage` que `tests/unit/chat-store.test.ts`, porque Vitest corre en entorno `node` y no hay `localStorage`):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { hasSeenWelcome, markWelcomeSeen, ONBOARDING_KEY } from "@/lib/tour/storage";

function fakeStorage(onSet?: () => void): Storage {
  let store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { onSet?.(); store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

const setStorage = (s: Storage | undefined) => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage = s as Storage;
};

beforeEach(() => { setStorage(fakeStorage()); });

describe("tour/storage", () => {
  it("arranca sin haber visto la bienvenida y la marca", () => {
    expect(hasSeenWelcome()).toBe(false);
    markWelcomeSeen();
    expect(hasSeenWelcome()).toBe(true);
  });

  it("tolera JSON corrupto", () => {
    localStorage.setItem(ONBOARDING_KEY, "{no json");
    expect(hasSeenWelcome()).toBe(false);
  });

  it("tolera un valor con forma inesperada", () => {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(["nope"]));
    expect(hasSeenWelcome()).toBe(false);
  });

  it("no lanza si localStorage no existe (SSR)", () => {
    setStorage(undefined);
    expect(() => hasSeenWelcome()).not.toThrow();
    expect(hasSeenWelcome()).toBe(false);
    expect(() => markWelcomeSeen()).not.toThrow();
  });

  it("no lanza si la cuota está agotada", () => {
    setStorage(fakeStorage(() => { throw new DOMException("quota", "QuotaExceededError"); }));
    expect(() => markWelcomeSeen()).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/tour-storage.test.ts`
Expected: FAIL — no resuelve `@/lib/tour/storage`.

- [ ] **Step 3: Escribir el storage**

Crear `src/lib/tour/storage.ts`:

```ts
// Estado del onboarding en localStorage. No hay identidad de usuario en la app
// (un solo password compartido), así que "sesión nueva" sólo puede distinguirse
// por navegador. Tolerante a SSR, JSON corrupto y cuota agotada, igual que
// src/lib/chat-store.ts.

export const ONBOARDING_KEY = "onboarding-v1";

interface OnboardingState { welcomeSeen?: boolean }

function read(): OnboardingState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ONBOARDING_KEY) : null;
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Array o primitivo => forma inesperada: se trata como estado vacío.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as OnboardingState)
      : {};
  } catch {
    return {};
  }
}

/** true si este navegador ya vio el modal de bienvenida alguna vez. */
export function hasSeenWelcome(): boolean {
  return read().welcomeSeen === true;
}

/**
 * Se llama al MOSTRAR el modal, no al completar el tour: la promesa es
 * "el modal aparece una vez por navegador", incluso si eligen "Ahora no".
 */
export function markWelcomeSeen(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ ...read(), welcomeSeen: true }));
  } catch {
    /* cuota agotada o modo privado: se ignora */
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/tour-storage.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Gate y commit**

```bash
npm test && npx tsc --noEmit && npm run lint
git add src/lib/tour/storage.ts tests/unit/tour-storage.test.ts
git commit -m "feat(tour): estado de la bienvenida en localStorage"
```

---

### Task 3: Los tres guiones

Todo el contenido del onboarding, como datos. Es la tarea que un revisor juzga por la **copy**, no por el código.

**Files:**
- Create: `src/lib/tour/scripts.ts`
- Test: `tests/unit/tour-scripts.test.ts`

**Interfaces:**
- Consumes: `TourScript`, `TourId`, `TourStep` de `@/lib/tour/types`; `DATABASES` de `@/lib/databases`.
- Produces: `const TOURS: Record<TourId, TourScript>`, `function tourScript(id: TourId): TourScript`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/tour-scripts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TOURS, tourScript } from "@/lib/tour/scripts";
import type { TourId } from "@/lib/tour/types";

const IDS: TourId[] = ["menu", "reports", "asistente"];
const all = IDS.map((id) => TOURS[id]);

describe("guiones del tour", () => {
  it("hay un guión por superficie y su id coincide con la llave", () => {
    for (const id of IDS) expect(TOURS[id].id).toBe(id);
    expect(tourScript("menu")).toBe(TOURS.menu);
  });

  it("todo paso tiene título y cuerpo no vacíos", () => {
    for (const s of all) {
      expect(s.steps.length).toBeGreaterThan(0);
      for (const step of s.steps) {
        expect(step.title.trim()).not.toBe("");
        expect(step.body.trim()).not.toBe("");
      }
    }
  });

  it("las anclas no se repiten dentro de un guión", () => {
    for (const s of all) {
      const anchors = s.steps.map((st) => st.anchor).filter(Boolean);
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });

  it("todo paso que abre algo declara cómo cerrarlo", () => {
    const abre = new Set(["openSidebar", "openExportModal", "openSyncModal"]);
    for (const s of all) {
      for (const step of s.steps) {
        if (step.before && abre.has(step.before)) expect(step.after).toBeTruthy();
      }
    }
  });

  it("el encadenado apunta a un guión existente y sólo desde el último paso", () => {
    for (const s of all) {
      if (!s.next) continue;
      expect(IDS).toContain(s.next.tour);
      expect(s.next.tour).not.toBe(s.id);
      expect(s.next.href.startsWith("/")).toBe(true);
      expect(s.next.label.trim()).not.toBe("");
    }
  });

  it("el menú encadena a reportes y el asistente cierra la cadena", () => {
    expect(TOURS.menu.next?.tour).toBe("reports");
    expect(TOURS.reports.next?.tour).toBe("asistente");
    expect(TOURS.asistente.next).toBeUndefined();
  });

  it("los conteos de pasos son los del spec", () => {
    expect(TOURS.menu.steps).toHaveLength(5);
    expect(TOURS.reports.steps).toHaveLength(7);
    expect(TOURS.asistente.steps).toHaveLength(4);
  });

  it("el destino del encadenado del menú se deriva de DATABASES, no está hardcodeado", () => {
    expect(TOURS.menu.next?.href).toBe("/db/tiempos/reports");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/tour-scripts.test.ts`
Expected: FAIL — no resuelve `@/lib/tour/scripts`.

- [ ] **Step 3: Escribir los guiones**

Crear `src/lib/tour/scripts.ts`:

```ts
// Contenido del onboarding: los tres guiones como datos.
//
// Viven centralizados (y no junto a cada página) para poder revisar toda la
// copy de una sentada. El riesgo de que un refactor borre un data-tour y el
// paso se omita en silencio lo cubre el E2E, que verifica el contador paso por
// paso (tests/e2e/onboarding.spec.ts).
import { DATABASES } from "@/lib/databases";
import type { TourId, TourScript } from "./types";

// El menú puede listar varias BDs cuando crezca databases.ts: el tour apunta a
// la primera tarjeta y encadena a ESA BD, en vez de hardcodear /db/tiempos.
const firstDb = DATABASES[0];

const menu: TourScript = {
  id: "menu",
  steps: [
    {
      title: "Bienvenido a ExportNotion",
      body:
        "Esta app sirve reportes y descargas de CSV desde una copia de tus bases de Notion. " +
        "No consulta Notion en vivo: la copia se refresca sola una vez al día, así las consultas son inmediatas.",
    },
    {
      anchor: "menu-asistente",
      title: "Asistente IA",
      body:
        "Pregunta en español —“¿cuántas horas registró cada persona en junio?”— y responde " +
        "consultando los mismos reportes que ves en esta app, no de memoria.",
    },
    {
      anchor: "menu-db-card",
      title: "Tus bases de datos",
      body:
        "Cada tarjeta es una base. El número son los registros que tiene la copia y abajo dice " +
        "hace cuánto se sincronizó. La tarjeta completa es un enlace a sus reportes.",
    },
    {
      anchor: "shell-sidebar",
      title: "Navegación",
      body:
        "Desde aquí saltas entre pantallas y cierras sesión. El ícono de pin ancla la barra o la " +
        "esconde detrás del botón ☰; la app recuerda tu preferencia.",
      side: "right",
      before: "openSidebar",
      after: "closeSidebar",
    },
    {
      anchor: "help-button",
      title: "Este botón te trae de vuelta",
      body:
        "El “?” repite la guía de la pantalla en la que estés, cuando quieras. Es el mismo recorrido, " +
        "sin necesidad de volver a iniciar sesión.",
      side: "left",
    },
  ],
  ...(firstDb
    ? { next: { href: `/db/${firstDb.slug}/reports`, tour: "reports" as TourId, label: `Continuar en ${firstDb.name}` } }
    : {}),
};

const reports: TourScript = {
  id: "reports",
  steps: [
    {
      anchor: "reports-snapshot",
      title: "El estado de la copia",
      body:
        "Cuántos registros tiene la copia y hace cuánto se sincronizó. Si dice 0 registros, hay que " +
        "sincronizar antes de que los reportes o la descarga tengan algo que mostrar.",
    },
    {
      anchor: "reports-filters",
      title: "Filtros combinables",
      body:
        "Rango de fechas más Persona, Subproyecto, Proyecto y Empresa. Todos son opcionales y se " +
        "combinan entre sí; sin nada seleccionado ves todos los registros. Si eliges exactamente " +
        "una persona (o un subproyecto) aparece un reporte extra: su matriz de horas por semana.",
    },
    {
      anchor: "reports-totals",
      title: "Totales del corte",
      body:
        "Horas, registros y personas activas de lo que dejaron ver los filtros — no del total de la " +
        "base. Cambia un filtro y estos tres números cambian con él.",
    },
    {
      anchor: "reports-timeline",
      title: "Evolución de horas",
      body:
        "La gráfica agrupa por semana o por mes, con los botones de la esquina. Click en una barra " +
        "abre los registros individuales de ese periodo.",
    },
    {
      anchor: "reports-tables",
      title: "Horas por persona y por subproyecto",
      body:
        "Ordenadas de mayor a menor, con la intensidad de color según las horas. Click en una fila " +
        "abre su detalle. Las filas “(sin persona)” y “(sin subproyecto)” agrupan lo que no tiene esa " +
        "relación en Notion, y por eso no son clickeables.",
    },
    {
      anchor: "export-modal",
      title: "Exportar a CSV",
      body:
        "El rango es opcional y filtra por fecha de creación: con ambos campos vacíos se descarga " +
        "toda la copia. El archivo sale en UTF-8, una fila por registro.",
      before: "openExportModal",
      after: "closeModal",
    },
    {
      anchor: "sync-modal",
      title: "Sincronizar con Notion",
      body:
        "Incremental trae sólo lo editado desde la última vez y tarda segundos; corre solo una vez " +
        "al día, y la cuenta regresiva marca la próxima. Full reconstruye la copia completa, tarda " +
        "minutos y sólo se dispara a mano. Si ya hay una sincronización en curso, aquí ves su avance " +
        "y puedes cancelarla guardando lo que alcanzó a descargar.",
      before: "openSyncModal",
      after: "closeModal",
    },
  ],
  next: { href: "/asistente", tour: "asistente", label: "Continuar en el Asistente IA" },
};

const asistente: TourScript = {
  id: "asistente",
  steps: [
    {
      anchor: "chat-composer",
      title: "Pregunta en lenguaje natural",
      body:
        "Escribe tu pregunta y el modelo elige qué reporte consultar para responderla. Los números " +
        "salen de la base, no del modelo.",
      side: "top",
    },
    {
      anchor: "chat-selectors",
      title: "Base y modelo",
      body:
        "Eliges sobre qué base preguntas y con qué modelo responde. Si dice “— sin modelo —”, falta " +
        "configurar uno en el servidor y el chat queda deshabilitado.",
      side: "top",
    },
    {
      anchor: "chat-history",
      title: "Tus conversaciones",
      body:
        "El historial se guarda en este navegador, no en el servidor: no lo verás desde otra " +
        "computadora, y se borra chat por chat con el ícono de bote.",
      side: "right",
    },
    {
      title: "Cómo verificar una respuesta",
      body:
        "Debajo de cada respuesta hay un desplegable que dice “consultó N herramienta(s)”: ahí ves " +
        "qué consultó para contestar. Si no aparece, el modelo respondió sin consultar datos y " +
        "conviene desconfiar del número.",
    },
  ],
};

export const TOURS: Record<TourId, TourScript> = { menu, reports, asistente };

export function tourScript(id: TourId): TourScript {
  return TOURS[id];
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/tour-scripts.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Gate y commit**

```bash
npm test && npx tsc --noEmit && npm run lint
git add src/lib/tour/scripts.ts tests/unit/tour-scripts.test.ts
git commit -m "feat(tour): guiones del menú, reportes y asistente"
```

---

### Task 4: El globo

Componente presentacional puro: recibe el paso y la posición ya calculada. Sin estado propio salvo el foco.

**Files:**
- Create: `src/app/components/tour/tour-popover.tsx`

**Interfaces:**
- Consumes: `Placement`, `POPOVER_W` de `@/lib/tour/geometry`.
- Produces: `function TourPopover(props: TourPopoverProps)` con
  `interface TourPopoverProps { title: string; body: string; index: number; total: number; placement: Placement; nextLabel: string; onNext: () => void; onPrev?: () => void; onSkip: () => void }`.

No lleva test unitario: Vitest corre en entorno `node` y este repo no tiene infraestructura de tests de componentes. Su comportamiento se verifica en `tests/e2e/onboarding.spec.ts` (tareas 5–9).

- [ ] **Step 1: Escribir el componente**

Crear `src/app/components/tour/tour-popover.tsx`:

```tsx
"use client";
// Globo del recorrido guiado. Presentacional: la posición ya viene calculada
// por popoverPlacement(). Al montar y en cada cambio de paso el foco va al
// botón principal, y Tab circula sólo entre los botones del globo (mientras el
// tour está activo el resto de la página está bloqueada por el overlay).
import { useEffect, useRef } from "react";
import { POPOVER_W, type Placement } from "@/lib/tour/geometry";

export interface TourPopoverProps {
  title: string;
  body: string;
  /** Índice 0-based del paso vigente. */
  index: number;
  total: number;
  placement: Placement;
  /** "Siguiente", "Terminar" o la etiqueta del encadenado. */
  nextLabel: string;
  onNext: () => void;
  /** Ausente en el primer paso. */
  onPrev?: () => void;
  onSkip: () => void;
}

export function TourPopover({
  title, body, index, total, placement, nextLabel, onNext, onPrev, onSkip,
}: TourPopoverProps) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // El foco sigue al paso: quien navega con teclado no pierde el hilo.
  useEffect(() => { nextRef.current?.focus(); }, [index]);

  // Trampa de Tab: mantiene el foco dentro del globo.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !boxRef.current) return;
    const focusables = boxRef.current.querySelectorAll<HTMLElement>("button");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  const style: React.CSSProperties = placement.mobile
    ? { top: placement.top }
    : { top: placement.top, left: placement.left, width: POPOVER_W };

  return (
    <div
      ref={boxRef}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      data-testid="tour-popover"
      data-tour-step={index}
      style={style}
      className={`fixed z-[57] space-y-3 rounded-2xl border border-sky/40 bg-surface p-5 shadow-2xl ${
        placement.mobile ? "left-2 right-2" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="tour-title" className="font-display text-base font-bold text-fg">{title}</h2>
        <button onClick={onSkip} aria-label="Cerrar el recorrido"
                className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-muted transition hover:text-danger">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <p className="text-sm leading-relaxed text-muted">{body}</p>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-xs tabular-nums text-muted" data-testid="tour-progress">
          {index + 1} / {total}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={onSkip}
                  className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition hover:text-fg">
            Saltar
          </button>
          {onPrev && (
            <button onClick={onPrev}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-blue hover:text-blue">
              Atrás
            </button>
          )}
          <button ref={nextRef} onClick={onNext}
                  className="rounded-lg bg-blue px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110">
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores. (No hay test que correr todavía: el componente no está montado en ninguna página.)

- [ ] **Step 3: Commit**

```bash
git add src/app/components/tour/tour-popover.tsx
git commit -m "feat(tour): globo del recorrido con foco y trampa de Tab"
```

---

### Task 5: Motor, botón "?" y tour del menú

Primera tarea con resultado visible: el "?" arriba a la derecha corre el tour del menú de punta a punta.

**Files:**
- Create: `src/app/components/tour/tour-layer.tsx`
- Modify: `src/app/components/app-shell.tsx` (props `tour`, ancla `shell-sidebar`, montar `TourLayer`)
- Modify: `src/app/page.tsx` (anclas del menú, binding del tour)
- Create: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `tourScript` de `@/lib/tour/scripts`; `popoverPlacement`, `Rect`, `Placement` de `@/lib/tour/geometry`; `TourActionId`, `TourId` de `@/lib/tour/types`; `TourPopover` de `./tour-popover`.
- Produces:
  - `interface TourBinding { id: TourId; actions?: Partial<Record<TourActionId, () => void>> }`
  - `function TourLayer(props: { tour: TourBinding; shellActions: Partial<Record<TourActionId, () => void>>; justLoggedIn?: boolean })`
  - `AppShell` acepta `tour?: TourBinding` y `justLoggedIn?: boolean` además de `children` y `onLogout`.

- [ ] **Step 1: Escribir el motor**

Crear `src/app/components/tour/tour-layer.tsx`:

```tsx
"use client";
// Motor del recorrido guiado.
//
// Vive dentro de AppShell y recibe por props el guión de la página y sus
// acciones. No usa contexto: AppShell es HIJO de cada página, así que un
// contexto declarado aquí no alcanzaría al componente que tiene el setModal.
//
// El spotlight son dos capas: un blocker a pantalla completa que se come los
// clicks (las box-shadow no capturan punteros) y encima un recorte con una
// sombra gigante que oscurece todo menos el ancla. Por eso ilumina elementos de
// cualquier z-index de la página: el recorte es transparente.
import { useCallback, useEffect, useRef, useState } from "react";
import { popoverPlacement, type Placement, type Rect } from "@/lib/tour/geometry";
import { tourScript } from "@/lib/tour/scripts";
import type { TourActionId, TourId } from "@/lib/tour/types";
import { TourPopover } from "./tour-popover";

export interface TourBinding {
  id: TourId;
  /** Handlers de las acciones que pide el guión de esta página. */
  actions?: Partial<Record<TourActionId, () => void>>;
}

type Actions = Partial<Record<TourActionId, () => void>>;

const anchorSelector = (anchor: string) => `[data-tour="${anchor}"]`;

function readRect(anchor: string): Rect | null {
  const el = document.querySelector<HTMLElement>(anchorSelector(anchor));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourLayer({ tour, shellActions }: { tour: TourBinding; shellActions: Actions }) {
  const script = tourScript(tour.id);
  const steps = script.steps;

  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const dirRef = useRef<1 | -1>(1);
  const cleanupRef = useRef<TourActionId | null>(null);
  const helpRef = useRef<HTMLButtonElement>(null);

  const active = index !== null;
  const step = index === null ? null : steps[index];

  const runAction = useCallback((id: TourActionId | null | undefined) => {
    if (!id) return;
    (tour.actions?.[id] ?? shellActions[id])?.();
  }, [tour, shellActions]);

  const start = useCallback(() => {
    dirRef.current = 1;
    setIndex(0);
  }, []);

  const stop = useCallback(() => {
    runAction(cleanupRef.current);
    cleanupRef.current = null;
    setIndex(null);
    setRect(null);
    setPlacement(null);
    helpRef.current?.focus();
  }, [runAction]);

  const goTo = useCallback((i: number, dir: 1 | -1) => {
    if (i < 0 || i >= steps.length) { stop(); return; }
    dirRef.current = dir;
    setIndex(i);
  }, [steps.length, stop]);

  const next = useCallback(() => {
    if (index === null) return;
    if (index === steps.length - 1) { stop(); return; }
    goTo(index + 1, 1);
  }, [index, steps.length, goTo, stop]);

  const prev = useCallback(() => {
    if (index === null || index === 0) return;
    goTo(index - 1, -1);
  }, [index, goTo]);

  /**
   * Un paso cuyo ancla no está en el DOM se omite en la dirección en la que
   * veníamos; si no queda ninguno, el tour termina limpio (corriendo el after
   * pendiente). Cubre tanto anclas condicionales como un data-tour borrado por
   * accidente en un refactor.
   */
  const skipFrom = useCallback((i: number, anchor: string) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[tour] paso omitido: no existe [data-tour="${anchor}"]`);
    }
    const to = i + dirRef.current;
    if (to < 0 || to >= steps.length) stop();
    else setIndex(to);
  }, [steps.length, stop]);

  // Al entrar a un paso: cierra lo del paso anterior y abre lo que este pida.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (index === null) return;
    const s = steps[index];
    runAction(cleanupRef.current);
    cleanupRef.current = s.after ?? null;
    runAction(s.before);
    setPlacement(null);
  }, [index, steps, runAction]);

  // Medición: se hace después del before (el ancla de un modal no existe hasta
  // que el modal se abre) y en un rAF, para medir ya pintado. Si el ancla no
  // aparece, el paso se omite en la dirección en la que veníamos.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (index === null) return;
    const s = steps[index];
    const vp = { width: window.innerWidth, height: window.innerHeight };

    if (!s.anchor) {
      setRect(null);
      setPlacement(popoverPlacement(null, vp, s.side));
      return;
    }

    let raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(anchorSelector(s.anchor!));
      if (!el) { skipFrom(index, s.anchor!); return; }
      // Scroll instantáneo a propósito: con "smooth" habría que esperar el
      // final de la animación para medir, y eso vuelve frágil el E2E.
      el.scrollIntoView({ block: "center", behavior: "auto" });
      raf = requestAnimationFrame(() => {
        const r = readRect(s.anchor!);
        setRect(r);
        setPlacement(popoverPlacement(r, { width: window.innerWidth, height: window.innerHeight }, s.side));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [index, steps, skipFrom]);

  // El rect se mueve con el scroll y el resize. El listener de scroll va en
  // captura porque los eventos de scroll no burbujean: así también cachamos el
  // de los contenedores con scroll propio (las tablas de reportes).
  useEffect(() => {
    if (!active || index === null || !step?.anchor) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = readRect(step.anchor!);
        // El ancla desapareció con el tour abierto: se omite el paso en vez de
        // quedarse señalando un rect que ya no existe.
        if (!r) { skipFrom(index, step.anchor!); return; }
        setRect(r);
        setPlacement(popoverPlacement(r, { width: window.innerWidth, height: window.innerHeight }, step.side));
      });
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active, index, step, skipFrom]);

  // Teclado. En CAPTURA y cortando la propagación: si no, el Esc que cierra el
  // tour llegaría también al listener del modal que el propio tour abrió.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, stop, next, prev]);

  const isLast = index !== null && index === steps.length - 1;

  return (
    <>
      <button ref={helpRef} onClick={start} data-tour="help-button"
              aria-label="Ayuda: iniciar el recorrido guiado" title="Recorrido guiado"
              className="fixed top-4 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface font-display text-base font-bold text-muted transition hover:border-blue hover:text-blue">
        ?
      </button>

      {active && placement && step && (
        <>
          {/* Blocker: se come los clicks. No cierra el tour a propósito —
              salir es explícito (Saltar, ✕ o Esc). */}
          <div className="fixed inset-0 z-[55]" aria-hidden />
          {rect ? (
            <div aria-hidden
                 className="pointer-events-none fixed rounded-xl ring-2 ring-sky"
                 style={{
                   top: rect.top - 4, left: rect.left - 4,
                   width: rect.width + 8, height: rect.height + 8,
                   boxShadow: "0 0 0 9999px rgba(5, 23, 88, 0.8)",
                   zIndex: 56,
                 }} />
          ) : (
            <div aria-hidden className="pointer-events-none fixed inset-0 z-[56] bg-dark-blue/80" />
          )}
          <TourPopover
            title={step.title} body={step.body}
            index={index} total={steps.length}
            placement={placement}
            nextLabel={isLast ? "Terminar" : "Siguiente"}
            onNext={next}
            onPrev={index > 0 ? prev : undefined}
            onSkip={stop}
          />
        </>
      )}
    </>
  );
}
```

> Dos notas sobre lo que **no** trae este motor todavía: `useRouter` no se importa aquí (la Tarea 9 lo agrega junto con el encadenado, para no dejar una variable sin usar que el lint rechace), y el recorte **no lleva ninguna transición CSS** — por eso no hace falta una media query de `prefers-reduced-motion`, y por eso el `scrollIntoView` es `behavior: "auto"`.

- [ ] **Step 2: Conectar `AppShell`**

En `src/app/components/app-shell.tsx`:

1. Agregar el import: `import { TourLayer, type TourBinding } from "@/app/components/tour/tour-layer";`
2. Cambiar la firma:

```tsx
export function AppShell({ children, onLogout, tour }: {
  children: React.ReactNode;
  onLogout: () => void;
  /** Guión de esta página. Sin él no hay botón "?" ni overlay. */
  tour?: TourBinding;
}) {
```

3. Poner el ancla en el `<aside>` (línea ~130), agregando el atributo sin tocar el resto:

```tsx
      <aside aria-label="Navegación" data-tour="shell-sidebar"
```

4. Montar el motor **dentro del envoltorio del contenido, antes de `{children}`** (línea ~192):

```tsx
      <div className={pinned ? "pt-12 lg:pl-60 lg:pt-0" : "pt-12"}>
        {tour && (
          <TourLayer tour={tour}
                     shellActions={{ openSidebar: () => setOpen(true), closeSidebar: () => setOpen(false) }} />
        )}
        {children}
      </div>
```

Por qué ahí y no al final del shell: el blocker, el recorte, el globo y el "?" son
`fixed`, así que su lugar en el árbol no cambia nada — pero la tira de bienvenida de la
Tarea 6 es contenido **en flujo**, y dentro de este envoltorio hereda el `lg:pl-60` (queda
a la derecha de la sidebar anclada) y el `pt-12` (queda por debajo de la hamburguesa en
móvil, sin que ésta le tape el texto).

- [ ] **Step 3: Anclar el menú y pasar el binding**

En `src/app/page.tsx`:

1. En el `<Link href="/asistente" …>` (línea ~118) agregar `data-tour="menu-asistente"`.
2. En el `<Link>` de cada BD (línea ~131) marcar **sólo la primera** tarjeta:

```tsx
        {DATABASES.map((db, i) => (
          <Link key={db.slug} href={`/db/${db.slug}/reports`}
                data-tour={i === 0 ? "menu-db-card" : undefined}
```

3. Pasar el binding: `<AppShell onLogout={…} tour={{ id: "menu" }}>`.

- [ ] **Step 4: Escribir el E2E del recorrido del menú**

Crear `tests/e2e/onboarding.spec.ts`:

```ts
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
```

> Ojo: estos tres tests corren **antes** de la Tarea 6, así que todavía no existe el modal de bienvenida y el `login()` local basta. La Tarea 6 los migra al helper compartido.

- [ ] **Step 5: Correr el E2E y verificar que pasa**

Run: `npx playwright test tests/e2e/onboarding.spec.ts`
Expected: 3 passed. Si falla el paso 4 por la sidebar, revisar que `data-tour="shell-sidebar"` esté en el `<aside>` y no en un envoltorio.

- [ ] **Step 6: Gate y commit**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run test:e2e
git add src/app/components/tour/tour-layer.tsx src/app/components/app-shell.tsx src/app/page.tsx tests/e2e/onboarding.spec.ts
git commit -m "feat(tour): motor del spotlight, botón ? y recorrido del menú"
```

---

### Task 6: Bienvenida tras iniciar sesión

**Files:**
- Create: `src/app/components/tour/welcome.tsx`
- Modify: `src/app/components/tour/tour-layer.tsx` (prop `justLoggedIn`, render de la bienvenida)
- Modify: `src/app/components/app-shell.tsx` (prop `justLoggedIn` de paso)
- Modify: `src/app/page.tsx` (estado `justLoggedIn`)
- Create: `tests/e2e/helpers.ts`
- Modify: `tests/e2e/smoke.spec.ts` (usar el helper; el modal taparía sus clicks)
- Modify: `tests/e2e/onboarding.spec.ts` (usar el helper + tests del disparo)

**Interfaces:**
- Consumes: `hasSeenWelcome`, `markWelcomeSeen` de `@/lib/tour/storage`.
- Produces:
  - `function WelcomeModal(props: { onStart: () => void; onDismiss: () => void })`
  - `function WelcomeBanner(props: { onStart: () => void; onDismiss: () => void })`
  - `TourLayer` acepta `justLoggedIn?: boolean`; `AppShell` lo reenvía.
  - `tests/e2e/helpers.ts`: `async function login(page: Page, opts?: { welcome?: "skip" | "expect" }): Promise<void>` — con `"skip"` (default) siembra `onboarding-v1` antes de cargar la página, así el modal no aparece.

- [ ] **Step 1: Escribir los dos componentes de bienvenida**

Crear `src/app/components/tour/welcome.tsx`:

```tsx
"use client";
// Dos formas de ofrecer el recorrido tras iniciar sesión:
// - Modal: sólo el primer login de este navegador (ahí sí interrumpe).
// - Tira: en los siguientes. Siempre hay una vía visible, sin estorbar.
import { useEffect, useRef } from "react";

export function WelcomeModal({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { startRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-dark-blue/80 p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" data-testid="welcome-modal"
           className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <h2 id="welcome-title" className="font-display text-xl font-bold text-fg">
          Bienvenido a ExportNotion
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          ¿Te muestro cómo funciona? Son cinco pasos y toma menos de un minuto. Puedes salir cuando
          quieras y retomarlo con el botón “?” de cualquier pantalla.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onDismiss}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition hover:border-blue hover:text-blue">
            Ahora no
          </button>
          <button ref={startRef} onClick={onStart}
                  className="rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white transition hover:brightness-110">
            Empezar
          </button>
        </div>
      </div>
    </div>
  );
}

export function WelcomeBanner({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div data-testid="welcome-banner"
         className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 text-sm sm:px-5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-sky" aria-hidden />
      <p className="min-w-0 flex-1 text-muted">
        ¿Nuevo por aquí?{" "}
        <button onClick={onStart} className="font-medium text-sky underline-offset-2 transition hover:underline">
          Iniciar tutorial
        </button>
      </p>
      <button onClick={onDismiss} aria-label="Ocultar el aviso del tutorial"
              className="shrink-0 rounded p-1 text-muted transition hover:text-fg">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Enchufar la bienvenida al motor**

En `src/app/components/tour/tour-layer.tsx`:

1. Imports nuevos:

```tsx
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/tour/storage";
import { WelcomeBanner, WelcomeModal } from "./welcome";
```

2. Firma:

```tsx
export function TourLayer({ tour, shellActions, justLoggedIn = false }: {
  tour: TourBinding;
  shellActions: Actions;
  /** true sólo tras un login exitoso en esta carga de página. */
  justLoggedIn?: boolean;
}) {
```

3. Estado y decisión del disparo (después de los `useState` existentes):

```tsx
  // "none" hasta que se resuelve en cliente: localStorage no existe en SSR.
  const [welcome, setWelcome] = useState<"none" | "modal" | "banner">("none");

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!justLoggedIn) return;
    if (hasSeenWelcome()) { setWelcome("banner"); return; }
    // Se marca al MOSTRARLO, no al completarlo: la promesa es "una vez por
    // navegador", incluso si eligen "Ahora no".
    markWelcomeSeen();
    setWelcome("modal");
  }, [justLoggedIn]);
```

4. `start` también cierra la bienvenida:

```tsx
  const start = useCallback(() => {
    setWelcome("none");
    dirRef.current = 1;
    setIndex(0);
  }, []);
```

5. Render, antes del botón "?":

```tsx
      {welcome === "banner" && !active && (
        <WelcomeBanner onStart={start} onDismiss={() => setWelcome("none")} />
      )}
      {welcome === "modal" && !active && (
        <WelcomeModal onStart={start} onDismiss={() => setWelcome("none")} />
      )}
```

> La tira es contenido **en flujo**: aparece arriba del contenido del menú. Eso ya funciona por el punto de montaje que fijó la Tarea 5 (dentro del envoltorio del contenido, antes de `{children}`); no hay que mover nada.

- [ ] **Step 3: Pasar `justLoggedIn` desde el menú**

En `src/app/components/app-shell.tsx`, agregar la prop y reenviarla:

```tsx
export function AppShell({ children, onLogout, tour, justLoggedIn }: {
  children: React.ReactNode;
  onLogout: () => void;
  tour?: TourBinding;
  justLoggedIn?: boolean;
}) {
```

```tsx
      {tour && (
        <TourLayer tour={tour} justLoggedIn={justLoggedIn}
                   shellActions={{ openSidebar: () => setOpen(true), closeSidebar: () => setOpen(false) }} />
      )}
```

En `src/app/page.tsx`:

1. Estado nuevo: `const [justLoggedIn, setJustLoggedIn] = useState(false);`
2. En `login()`, dentro del `if (r.ok)`, marcarlo — un F5 con la cookie viva **no** debe contar como inicio de sesión, y por eso no se toca `loadStatus()`:

```tsx
      if (r.ok) { setPassword(""); setJustLoggedIn(true); await loadStatus(); }
```

3. Al cerrar sesión, limpiarlo: `onLogout={() => { setAuthed(false); setStatus(null); setJustLoggedIn(false); }}`
4. Pasarlo: `<AppShell onLogout={…} tour={{ id: "menu" }} justLoggedIn={justLoggedIn}>`

- [ ] **Step 4: Crear el helper de login y migrar los E2E existentes**

Crear `tests/e2e/helpers.ts`:

```ts
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
  if ((opts.welcome ?? "skip") === "skip") {
    await expect(page.getByTestId("welcome-modal")).toBeHidden();
  }
}
```

En `tests/e2e/smoke.spec.ts`: reemplazar en los cinco tests que inician sesión el trío
`page.goto("/")` + `fill` + `click("Entrar")` por `await login(page);`, agregando
`import { login } from "./helpers";`. El primer test (password incorrecto) y el de
redirect legacy **no** se tocan: no inician sesión.

> Por qué es necesario: la tira discreta desplaza el contenido y el modal cubre la pantalla. `sidebar.getByRole("link", { name: "BD Tiempos" }).click()` fallaría con "element intercepted pointer events". Sembrar `welcomeSeen` deja esos tests probando lo que probaban.

En `tests/e2e/onboarding.spec.ts`: borrar la función `login` local y usar la del helper
(`import { login } from "./helpers";`), llamándola como `await login(page)` en los tres
tests existentes.

- [ ] **Step 5: Escribir los tests del disparo**

Agregar a `tests/e2e/onboarding.spec.ts`:

```ts
test("el primer login de un navegador ofrece el recorrido en un modal", async ({ page }) => {
  await login(page, { welcome: "expect" });
  const modal = page.getByTestId("welcome-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Empezar" }).click();
  await expect(modal).toBeHidden();
  await expect(progress(page)).toHaveText("1 / 5");
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
  await expect(page.getByRole("heading", { name: "Bases de datos" })).toBeVisible();
  await expect(page.getByTestId("welcome-modal")).toBeHidden();
  await expect(page.getByTestId("welcome-banner")).toBeHidden();
});
```

- [ ] **Step 6: Correr el E2E completo y verificar que pasa**

Run: `npm run test:e2e`
Expected: todos verdes — los 7 de `onboarding.spec.ts` y los 6 de `smoke.spec.ts`.

- [ ] **Step 7: Gate y commit**

```bash
npm test && npx tsc --noEmit && npm run lint
git add src/app/components/tour/welcome.tsx src/app/components/tour/tour-layer.tsx src/app/components/app-shell.tsx src/app/page.tsx tests/e2e/helpers.ts tests/e2e/smoke.spec.ts tests/e2e/onboarding.spec.ts
git commit -m "feat(tour): bienvenida al iniciar sesión (modal la 1a vez, tira después)"
```

---

### Task 7: Recorrido de reportes, con apertura de modals

La tarea que prueba la parte más ambiciosa del diseño: pasos que abren los modals y los cierran solos.

**Files:**
- Modify: `src/app/db/tiempos/reports/page.tsx` (5 anclas, prop `anchor` en `Modal`, binding con acciones)
- Modify: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `AppShell` con `tour`; `TourBinding`.
- Produces: el componente local `Modal` acepta `anchor?: string` y lo pinta como `data-tour` en su panel.

- [ ] **Step 1: Anclar las secciones**

En `src/app/db/tiempos/reports/page.tsx`, agregar el atributo a las `<section>` existentes sin cambiar nada más:

| Línea aprox. | Elemento | Atributo |
|---|---|---|
| 374 | `<section>` del snapshot (registros + botones) | `data-tour="reports-snapshot"` |
| 420 | `<section>` de filtros | `data-tour="reports-filters"` |
| 444 | `<section className="grid grid-cols-3 …">` de totales | `data-tour="reports-totals"` |
| 458 | `<section>` de "Evolución de horas" | `data-tour="reports-timeline"` |
| 526 | `<div className="space-y-5">` que envuelve las dos tablas | `data-tour="reports-tables"` |

- [ ] **Step 2: Dar ancla al `Modal` local**

En el mismo archivo, el componente `Modal` (línea ~725):

```tsx
function Modal({ title, onClose, anchor, children }: {
  title: string; onClose: () => void; anchor?: string; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-dark-blue/80 p-4 sm:p-10"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div data-tour={anchor} className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl">
```

Y en las dos invocaciones:

```tsx
        <Modal title="Exportar CSV" anchor="export-modal" onClose={() => setModal(null)}>
```

```tsx
        <Modal title="Sincronización" anchor="sync-modal" onClose={() => setModal(null)}>
```

- [ ] **Step 3: Pasar el binding con las acciones**

En el `return` de `Reports()` (línea ~366):

```tsx
    <AppShell onLogout={() => setAuthed(false)}
              tour={{ id: "reports", actions: {
                openExportModal: () => setModal("export"),
                openSyncModal: () => setModal("sync"),
                closeModal: () => setModal(null),
              } }}>
```

- [ ] **Step 4: Escribir el E2E de reportes**

Agregar a `tests/e2e/onboarding.spec.ts`:

```ts
test("el recorrido de reportes abre y cierra los modals por su cuenta", async ({ page }) => {
  await login(page);
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();

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

  // Terminar corre el after pendiente: ningún modal queda abierto.
  await page.getByRole("button", { name: "Terminar" }).click();
  await expect(popover(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeHidden();
});

test("Esc en un paso que abrió un modal cierra ambos", async ({ page }) => {
  await login(page);
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await page.getByRole("button", { name: /Ayuda/ }).click();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeHidden();
  // La página sigue usable, sin overlay huérfano.
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
});

test("Atrás desde el paso de sync regresa al de export", async ({ page }) => {
  await login(page);
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await page.getByRole("button", { name: /Ayuda/ }).click();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeVisible();

  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(progress(page)).toHaveText("6 / 7");
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Descargar" })).toBeVisible();
});
```

- [ ] **Step 5: Correr el E2E y verificar que pasa**

Run: `npx playwright test tests/e2e/onboarding.spec.ts`
Expected: 10 passed.

- [ ] **Step 6: Gate y commit**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run test:e2e
git add src/app/db/tiempos/reports/page.tsx tests/e2e/onboarding.spec.ts
git commit -m "feat(tour): recorrido de reportes con apertura guiada de modals"
```

---

### Task 8: Recorrido del asistente

**Files:**
- Modify: `src/app/asistente/page.tsx` (3 anclas, binding)
- Modify: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `AppShell` con `tour`.
- Produces: anclas `chat-composer`, `chat-selectors`, `chat-history`.

- [ ] **Step 1: Anclar y pasar el binding**

En `src/app/asistente/page.tsx`:

1. En `renderComposer` (línea ~169), el contenedor externo:

```tsx
    <div data-tour="chat-composer"
         className="rounded-2xl border border-border bg-dark-blue transition focus-within:border-blue focus-within:ring-2 focus-within:ring-blue/30">
```

2. La fila de dropdowns dentro del compositor (línea ~175):

```tsx
      <div data-tour="chat-selectors" className="flex items-center gap-2 px-2.5 pb-2.5">
```

3. El `<aside>` del historial (línea ~211): agregar `data-tour="chat-history"`.
4. El shell: `<AppShell onLogout={() => setAuthed(false)} tour={{ id: "asistente" }}>`

> `renderComposer` se invoca en una sola rama a la vez (estado vacío **o** barra al pie), así que nunca hay dos `chat-composer` en el DOM.

- [ ] **Step 2: Escribir el E2E**

Agregar a `tests/e2e/onboarding.spec.ts`:

```ts
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
```

- [ ] **Step 3: Correr el E2E y verificar que pasa**

Run: `npx playwright test tests/e2e/onboarding.spec.ts`
Expected: 11 passed.

- [ ] **Step 4: Gate y commit**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run test:e2e
git add src/app/asistente/page.tsx tests/e2e/onboarding.spec.ts
git commit -m "feat(tour): recorrido del Asistente IA"
```

---

### Task 9: Encadenado entre páginas

**Files:**
- Modify: `src/app/components/tour/tour-layer.tsx` (botón de encadenado, autoarranque por `?tour=`, limpieza de URL)
- Modify: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `script.next` de `@/lib/tour/scripts`; `useRouter` de `next/navigation`.
- Produces: nada nuevo hacia afuera; el `TourPopover` recibe `nextLabel` = `script.next.label` en el último paso.

- [ ] **Step 1: Implementar el encadenado**

En `src/app/components/tour/tour-layer.tsx`:

0. Traer el router, que hasta ahora no se usaba: agregar `import { useRouter } from "next/navigation";` y, dentro del componente junto a los otros hooks, `const router = useRouter();`

1. Autoarranque desde la URL. `window.location.search` en un efecto en vez de `useSearchParams()`: en Next 16 ese hook obliga a envolver la página en un `Suspense` para el prerender, y aquí no hace falta.

```tsx
  // Llegada por encadenado: /ruta?tour=<id>. Se limpia la URL para que un
  // refresh no vuelva a arrancar el recorrido.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tour");
    if (requested !== tour.id) return;
    dirRef.current = 1;
    setIndex(0);
    router.replace(window.location.pathname);
  }, [tour.id, router]);
```

2. La navegación al siguiente guión:

```tsx
  const goNextTour = useCallback(() => {
    const n = script.next;
    if (!n) { stop(); return; }
    runAction(cleanupRef.current);
    cleanupRef.current = null;
    setIndex(null);
    setRect(null);
    setPlacement(null);
    router.push(`${n.href}?tour=${n.tour}`);
  }, [script.next, stop, runAction, router]);
```

3. El último paso ofrece encadenar en vez de terminar:

```tsx
          <TourPopover
            title={step.title} body={step.body}
            index={index} total={steps.length}
            placement={placement}
            nextLabel={isLast ? (script.next?.label ?? "Terminar") : "Siguiente"}
            onNext={isLast && script.next ? goNextTour : next}
            onPrev={index > 0 ? prev : undefined}
            onSkip={stop}
          />
```

> Los tests de las tareas 5 y 8 esperan "Terminar" en el último paso del menú y del asistente. El asistente no tiene `next`, así que sigue diciendo "Terminar"; **el del menú ahora dice "Continuar en BD Tiempos"**. Hay que actualizar esos dos asserts del test del menú (Step 2).

- [ ] **Step 2: Actualizar el test del menú y escribir el del encadenado**

En `tests/e2e/onboarding.spec.ts`, en el test "el botón ? corre el recorrido del menú paso por paso", cambiar el cierre:

```ts
  // El último paso del menú encadena en vez de terminar.
  await expect(page.getByRole("button", { name: "Continuar en BD Tiempos" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
```

Y agregar:

```ts
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
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  await expect(popover(page)).toBeHidden();
});
```

- [ ] **Step 3: Correr el E2E y verificar que pasa**

Run: `npx playwright test tests/e2e/onboarding.spec.ts`
Expected: 13 passed.

- [ ] **Step 4: Gate y commit**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run test:e2e
git add src/app/components/tour/tour-layer.tsx tests/e2e/onboarding.spec.ts
git commit -m "feat(tour): encadenado opt-in entre recorridos"
```

---

### Task 10: Documentación y verificación final

**Files:**
- Modify: `CLAUDE.md` (subsección del tour bajo *Páginas (UI)*)
- Modify: `docs/to-dos.md` (pendiente del manual de usuario)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: documentación.

- [ ] **Step 1: Documentar en `CLAUDE.md`**

Agregar al final de la sección *Páginas (UI)*, después del bullet de `app-shell.tsx`:

```markdown
- **Onboarding guiado** (`src/lib/tour/` + `src/app/components/tour/`) — spotlight por página: un `<div>` sobre el rect del ancla con `box-shadow: 0 0 0 9999px rgba(5,23,88,.8)` oscurece todo menos el recorte, más un blocker que se come los clicks (las sombras no capturan punteros). Tres guiones declarativos en `scripts.ts` (`menu` 5 pasos → `reports` 7 → `asistente` 4) con encadenado **opt-in** vía `?tour=<id>`. El tour entra a las páginas **por props de `AppShell`** (`tour={{id, actions}}`), no por contexto: `AppShell` es hijo de la página, así que un contexto declarado en el shell no alcanzaría al componente que tiene el `setModal`. Los pasos declaran `before`/`after` (`openSyncModal`/`closeModal`) para explicar los modals por dentro; el `after` corre también al abortar, así un tour cancelado no deja un modal abierto. El "?" flotante arriba a la derecha reinicia el recorrido de la página. La bienvenida se ofrece **una sola vez por navegador** en modal (`localStorage` key `onboarding-v1`) y como tira discreta en los logins siguientes; sólo cuenta un `POST /api/login` exitoso, no un F5 con la cookie viva. ⚠️ Los E2E que inician sesión deben usar `login()` de `tests/e2e/helpers.ts`: sin sembrar `welcomeSeen`, el modal intercepta los clicks.
```

- [ ] **Step 2: Registrar el pendiente del manual**

En `docs/to-dos.md`, agregar una sección:

```markdown
## 3. Documentación de usuario

- [ ] **DOC-01** — Reescribir [guides/manual-usuario.md](guides/manual-usuario.md): describe el
      dashboard viejo (fusionado con reportes el 2026-07-16) y un cron full que ya no existe
      (ADR-0007). El onboarding guiado (2026-07-29) cubre el recorrido básico en la app, así que
      el manual debería quedarse con lo que un tour no puede dar: formato del CSV, tabla de
      problemas comunes y calendario de sincronizaciones.
```

- [ ] **Step 3: Verificación completa**

Correr las cuatro y mostrar la salida real:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run test:e2e
```

Expected: unit + integration verdes, typecheck limpio, lint limpio, 13 tests de `onboarding.spec.ts` y 6 de `smoke.spec.ts` en verde.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/to-dos.md
git commit -m "docs: documenta el onboarding guiado y el pendiente del manual"
```

- [ ] **Step 5: Revisar el diff completo de la rama**

```bash
git diff main...HEAD --stat
git diff main...HEAD
```

Mostrarlo al autor: **él revisa el diff, no el resumen** (`docs/instruccionesGit.md`). Después correr `/code-review` sobre el diff y reportar sólo los hallazgos que afecten corrección o los requisitos del spec.
