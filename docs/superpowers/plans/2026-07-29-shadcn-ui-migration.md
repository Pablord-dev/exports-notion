# Plan: migración de la UI a shadcn/ui con tema iU Corp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la UI hecha a mano de ExportNotion por componentes de shadcn/ui tematizados con la paleta dark de iU Corp, sin ningún cambio de lógica de datos ni de comportamiento observable por los E2E.

**Architecture:** shadcn/ui en modo Tailwind v4 + CSS variables, dark fijo (tokens definidos una vez en `:root`, sin clase `.dark`). Los componentes generados por la CLI viven en `src/components/ui/` y se ajustan como código propio. El shell (sidebar anclada/overlay) y el motor del tour conservan su lógica; solo se restilizan.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19, Tailwind CSS 4, shadcn/ui (CLI `shadcn@latest`), Radix UI, lucide-react, Recharts (vía shadcn Charts), Playwright (E2E stub), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-29-shadcn-ui-migration-design.md` (leerlo antes de empezar).

## Global Constraints

- Rama de trabajo: `feat/shadcn-ui` (ya creada). Commits pequeños, mensajes en imperativo ≤72 chars.
- Gate al cierre de CADA tarea: `npm test && npm run lint && npx tsc --noEmit` — mostrar salida real.
- E2E (`npm run test:e2e`, modo stub) donde la tarea lo indique. ⚠️ No correr `npm run dev` a la vez: el build E2E pisa `.next` del dev server.
- Tipografía: Raleway (display) + Poppins (sans) — NO cambiar `src/app/layout.tsx`.
- Dark fijo: sin clase `.dark`, sin toggle de tema.
- PROHIBIDO cambiar: textos visibles (los E2E los usan), atributos `data-tour="…"`, keys de `localStorage` (`sidebar-pinned`, `onboarding-v1`, `asistente-chats-v1`), roles/aria-labels (`complementary`/"Navegación", "Abrir menú", "Anclar menú"/"Desanclar menú", "Cerrar sesión", "Entrar", placeholder "Contraseña", "Exportar", "Sincronizar", "Descargar", "Refrescar incremental", "Full", "Cargar más", "Nuevo chat", placeholder "Escribe tu pregunta…"). Única excepción: los selectores del composer pasan a `role="combobox"` (Tarea 8 actualiza el smoke test).
- PROHIBIDO tocar: `src/lib/**` (salvo crear `src/lib/utils.ts`), `src/app/api/**`, `src/proxy.ts`, tests de `tests/unit` y `tests/integration`, `vercel.json`, `.env*`, migraciones.
- El motor del tour (`src/app/components/tour/tour-layer.tsx`) NO se toca. Sus capas usan `z-[55]`–`z-[58]`; todo lo nuevo debe quedar por debajo (Dialog/Popover de shadcn usan `z-50` — no subirlos).
- No introducir logotipo/isotipo ni el texto "iU Corporation" en la UI.

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `components.json` | Crear | Config de la CLI de shadcn |
| `src/lib/utils.ts` | Crear | Helper `cn()` |
| `src/app/globals.css` | Reescribir | Tokens shadcn (dark fijo) + tokens de marca restantes |
| `src/components/ui/*.tsx` | Crear (CLI) | Primitivas shadcn (código propio tras generarse) |
| `src/components/app-modal.tsx` | Crear | Modal no bloqueante sobre Dialog (`modal={false}`) |
| `src/app/components/spinner.tsx` | Reescribir | `Loader2` de lucide, mismo API |
| `src/app/components/app-shell.tsx` | Reescribir | Shell: misma máquina de estados, primitivas shadcn |
| `src/app/page.tsx` | Reescribir UI | Login (Card/Input/Button) + menú (Cards) |
| `src/app/db/tiempos/reports/page.tsx` | Reescribir UI | Reportes: AppModal, Table, Tabs, Card |
| `src/app/db/tiempos/reports/components.tsx` | Reescribir | `MultiSelect` (Popover+Command) y `TimelineChart` (Recharts) |
| `src/app/asistente/page.tsx` | Reescribir UI | Select, Textarea, Sheet, Buttons |
| `src/app/components/tour/tour-popover.tsx`, `welcome.tsx` | Restilizar | Solo clases/Buttons; lógica intacta |
| `src/app/components/dropdown.tsx`, `breadcrumb.tsx` | Eliminar (Tarea 10) | Sustituidos por Select y Breadcrumb shadcn |
| `tests/e2e/smoke.spec.ts` | Editar (Tarea 8) | button→combobox en el composer |
| `CLAUDE.md` | Editar (Tarea 10) | Documentar shadcn en la sección de UI |

**Nota sobre tests:** no hay tests unitarios de componentes React (no existe testing-library en el repo y no se agrega — YAGNI). La red de regresión de esta migración son los E2E existentes (`smoke.spec.ts`, `onboarding.spec.ts`) más los gates. Cada tarea declara qué E2E la cubre.

---

### Task 1: Infraestructura shadcn (config + deps + utils)

**Files:**
- Create: `components.json`
- Create: `src/lib/utils.ts`
- Modify: `package.json` (deps vía npm install)

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` en `@/lib/utils` — lo consumen todos los componentes generados.

- [x] **Step 1: Crear `components.json`** con este contenido exacto:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [x] **Step 2: Instalar dependencias base**

Run: `npm install clsx tailwind-merge class-variance-authority lucide-react tw-animate-css`
Expected: exit 0, package.json actualizado.

- [x] **Step 3: Crear `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [x] **Step 4: Gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS (nada consume aún lo nuevo).

- [x] **Step 5: Commit**

```bash
git add components.json src/lib/utils.ts package.json package-lock.json
git commit -m "chore(ui): configura shadcn/ui (components.json, cn, deps base)"
```

---

### Task 2: Tema dark iU en tokens shadcn + sweep de clases

**Files:**
- Modify: `src/app/globals.css` (reescritura completa)
- Modify: todos los `.tsx` bajo `src/app/` (renombres de clases)

**Interfaces:**
- Produces: utilidades `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, etc. (semántica shadcn) + utilidades de marca `bg-blue`, `text-sky`, `text-danger`, `text-warning`, `text-success`, `font-display`.
- **Elimina** las utilidades `bg-surface`, `text-fg`, `text-muted`, `bg-dark-blue` (renombradas en el sweep).

- [x] **Step 1: Reescribir `src/app/globals.css`** con este contenido exacto (conserva scrollbars y fuentes actuales):

```css
@import "tailwindcss";
@import "tw-animate-css";

/* ============================================================
   Identidad visual — iU Corporation / iU Corp · TEMA DARK (fijo)
   Tokens semánticos de shadcn/ui tematizados con la paleta iU.
   No hay clase .dark ni toggle: la única versión es la oscura.
   ============================================================ */

/* Tokens de marca que shadcn no cubre (acentos y estados).
   Generan bg-blue, text-sky, text-danger, font-display, etc. */
@theme {
  --color-blue: #0f40ef;        /* Unique Blue — acciones */
  --color-sky: #02b5d3;         /* Unique Sky Blue — cifras y serie de datos */
  --color-ink: #121212;         /* Unique Black (referencia de marca) */

  /* Neutros del brandbook (referencia) */
  --color-neutral-100: #f4f4f4;
  --color-neutral-200: #e9e9e9;
  --color-neutral-300: #d3d3d3;
  --color-neutral-400: #666666;

  /* Terciaria — solo acento (<20%) */
  --color-danger: #f05347;      /* Unique Red 600 */
  --color-success: #66b169;     /* Unique Green 500 */
  --color-warning: #b57ed1;     /* Unique Purple 400 */

  /* Tipografía brandbook: Raleway (títulos) + Poppins (cuerpo). */
  --font-display: var(--font-raleway), Lato, Arial, sans-serif;
  --font-sans: var(--font-poppins), Lato, Arial, sans-serif;
}

/* Tokens semánticos shadcn — dark fijo, definidos una sola vez. */
:root {
  --radius: 0.625rem;
  --background: #051758;            /* Unique Dark Blue — fondo de página */
  --foreground: #f4f4f4;            /* texto principal */
  --card: #0a2468;                  /* tarjetas — dark-blue elevado */
  --card-foreground: #f4f4f4;
  --popover: #0a2468;
  --popover-foreground: #f4f4f4;
  --primary: #0f40ef;               /* Unique Blue */
  --primary-foreground: #ffffff;
  --secondary: #1c3c84;
  --secondary-foreground: #f4f4f4;
  --muted: #0a2468;
  --muted-foreground: #9a9a9a;      /* texto secundario */
  --accent: #051758;                /* hover de items en menús/popovers */
  --accent-foreground: #f4f4f4;
  --destructive: #f05347;
  --destructive-foreground: #ffffff;
  --border: #1c3c84;
  --input: #1c3c84;
  --ring: #0f40ef;
  --chart-1: #02b5d3;
  --chart-2: #0f40ef;
  --chart-3: #b57ed1;
  --chart-4: #66b169;
  --chart-5: #f05347;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  h1, h2, h3 {
    font-family: var(--font-display);
    font-weight: 700;
  }
}

/* Scrollbars acordes al tema dark: delgados, thumb azulado sobre track
   transparente. scrollbar-* cubre Firefox y Chromium moderno; las reglas
   ::-webkit-* son fallback para navegadores sin soporte de scrollbar-color. */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover {
  background: #2a54ad;
  border: 2px solid transparent;
  background-clip: content-box;
}
```

- [x] **Step 2: Sweep de clases en todos los `.tsx` de `src/app/`** (páginas, componentes y tour). Renombres, en este orden y con cuidado de no tocar `text-muted-foreground` ya generado:

| Antes | Después |
|---|---|
| `text-fg` | `text-foreground` |
| `text-muted` (cuando NO va seguido de `-`) | `text-muted-foreground` (incluye variantes: `text-muted/40` → `text-muted-foreground/40`, `placeholder:text-muted` → `placeholder:text-muted-foreground`, `hover:text-fg` → `hover:text-foreground`) |
| `bg-surface` (y `bg-surface/60`, `/80`) | `bg-card` (misma opacidad) |
| `bg-dark-blue` (y `/40 /50 /60 /70 /80`) | `bg-background` (misma opacidad) |
| `shadow-dark-blue/60` | `shadow-background/60` |
| `border-border` | sin cambio (ahora lo provee shadcn con el mismo valor) |
| `text-sky`, `bg-blue`, `border-blue`, `ring-blue/*`, `text-danger`, `border-danger`, `text-warning`, `font-display` | sin cambio (marca) |

Archivos afectados (verificar con grep tras el sweep — `rg 'text-fg|bg-surface|bg-dark-blue|text-muted(?![-a-z])' src/ --pcre2` debe devolver vacío): `page.tsx`, `asistente/page.tsx`, `db/tiempos/reports/page.tsx`, `db/tiempos/reports/components.tsx`, `components/app-shell.tsx`, `components/dropdown.tsx`, `components/breadcrumb.tsx`, `components/markdown-message.tsx`, `components/tour/tour-layer.tsx`, `components/tour/tour-popover.tsx`, `components/tour/welcome.tsx`.

⚠️ En `components.tsx` (BarChart SVG) hay hexes literales (`#1c3c84`, `#9a9a9a`, `#02b5d3`) — dejarlos: ese componente muere en la Tarea 7.

- [x] **Step 3: Gate + E2E**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run test:e2e`
Expected: todo PASS — el sweep es un renombre puro; si un E2E falla, hay una clase mal renombrada.

- [x] **Step 4: Commit**

```bash
git add src/app
git commit -m "feat(ui): tema dark iU en tokens shadcn y clases semánticas"
```

---

### Task 3: Primitivas shadcn + Spinner + AppModal

**Files:**
- Create (CLI): `src/components/ui/{button,card,input,textarea,label,dialog,sheet,table,popover,command,select,breadcrumb,collapsible,tabs,badge,separator,skeleton,chart}.tsx`
- Create: `src/components/app-modal.tsx`
- Rewrite: `src/app/components/spinner.tsx`

**Interfaces:**
- Produces: todos los componentes `@/components/ui/*` estándar de shadcn.
- Produces: `AppModal({ open, onClose, title, anchor?, wide?, children })` — modal NO bloqueante (Esc y click fuera cierran; el tour puede clickear su popover con el modal abierto).
- Produces: `Spinner({ className? })` — mismo API que hoy (los callsites no se tocan).

- [ ] **Step 1: Agregar componentes con la CLI**

Run: `npx shadcn@latest add --yes button card input textarea label dialog sheet table popover command select breadcrumb collapsible tabs badge separator skeleton chart`
Expected: archivos creados en `src/components/ui/`; instala deps Radix + `recharts` + `cmdk`. Si la CLI pide confirmación interactiva pese a `--yes`, correrla por grupos pequeños.

- [ ] **Step 2: Ajustar `src/components/ui/input.tsx`** — inputs "recesados" del brandbook: en la cadena de clases base del `<input>`, sustituir `bg-transparent` por `bg-background` y agregar `[color-scheme:dark]` (para que el date picker nativo salga oscuro). Si hay variantes `dark:bg-input/30`, eliminarlas (no hay clase dark).

- [ ] **Step 3: Reescribir `src/app/components/spinner.tsx`**:

```tsx
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Mismo API del Spinner previo: los callsites pasan tamaño/color por className.
export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("h-4 w-4 animate-spin", className)} />;
}
```

- [ ] **Step 4: Crear `src/components/app-modal.tsx`**:

```tsx
"use client";
// Modal NO bloqueante sobre Radix Dialog con modal={false}: el onboarding
// guiado necesita clickear su popover con un modal abierto, y un Dialog modal
// vuelve inert todo lo de afuera. En modo no-modal Radix no monta el Overlay,
// así que el backdrop es propio; el click fuera cierra por el
// onPointerDownOutside default de Radix y Esc por su listener de documento.
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AppModal({ open, onClose, title, anchor, wide, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** valor para data-tour en el contenido (ancla del onboarding) */
  anchor?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null; // el backdrop propio no debe quedar montado cerrado
  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/80" aria-hidden />
      <Dialog open modal={false} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent data-tour={anchor}
                       className={wide ? "max-h-[85vh] overflow-y-auto sm:max-w-4xl" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle className="font-display text-base font-semibold">{title}</DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}
```

⚠️ Verificaciones de este componente (quedan cubiertas por E2E en Tareas 6–7): el backdrop debe ser el ÚNICO `div.fixed.inset-0` visible con el modal abierto (el smoke test lo clickea con locator estricto); `DialogContent` de shadcn usa `z-50` — no subirlo (el tour vive en `z-[55]+`).

- [ ] **Step 5: Gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS. Si eslint marca los archivos generados, corregirlos (son código propio).

- [ ] **Step 6: Commit**

```bash
git add src/components src/app/components/spinner.tsx package.json package-lock.json
git commit -m "feat(ui): agrega primitivas shadcn, AppModal no bloqueante y Spinner lucide"
```

---

### Task 4: AppShell restilizado (misma máquina de estados)

**Files:**
- Rewrite: `src/app/components/app-shell.tsx`

**Interfaces:**
- Consumes: `Button`, `Collapsible*` de `@/components/ui`, iconos lucide, `Spinner`.
- Produces: `AppShell({ children, onLogout, tour?, justLoggedIn? })` — API idéntico al actual; `<aside role complementary aria-label="Navegación">`, botones "Abrir menú"/"Anclar menú"/"Desanclar menú"/"Cerrar menú"/"Cerrar sesión", key `sidebar-pinned`, `shellActions {openSidebar, closeSidebar}` al TourLayer.

- [ ] **Step 1: Reescribir el componente.** Estado (`pinned`/`open`/`dbsOpen`/`loggingOut`), efectos, `togglePin`, `logout`, el `<aside data-tour="shell-sidebar">` con sus transforms y el bloque final `<div className={pinned ? "pt-12 lg:pl-60 lg:pt-0" : "pt-12"}>` + `TourLayer` quedan EXACTAMENTE como hoy. Cambian los internos:

  - Eliminar los componentes de iconos SVG a mano (`HomeIcon`, `DatabaseIcon`, `TableIcon`, `ChatIcon`, `LogoutIcon`) e importar de lucide: `Home`, `Database`, `Table2`, `MessageSquare`, `LogOut`, `Menu`, `X`, `Pin`, `PinOff`, `ChevronRight` — siempre con `className="h-4 w-4 shrink-0"` (hamburguesa `h-5 w-5`).
  - Hamburguesa:

```tsx
{!open && (
  <Button variant="outline" size="icon" onClick={() => setOpen(true)} aria-label="Abrir menú"
          className={`fixed top-4 left-4 z-30 bg-card text-muted-foreground hover:text-blue ${pinned ? "lg:hidden" : ""}`}>
    <Menu className="h-5 w-5" />
  </Button>
)}
```

  - Botón anclar (dentro del header del aside; conservar aria-label dinámico y title):

```tsx
<Button variant="ghost" size="icon" onClick={togglePin}
        aria-label={pinned ? "Desanclar menú" : "Anclar menú"} title={pinned ? "Desanclar" : "Anclar"}
        className={`hidden h-8 w-8 lg:inline-flex ${pinned ? "text-sky" : "text-muted-foreground"}`}>
  {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
</Button>
```

  - Botón cerrar overlay: `Button variant="ghost" size="icon"` con `<X className="h-4 w-4" />`, aria-label "Cerrar menú", clase extra `${pinned ? "lg:hidden" : ""}`.
  - `NavLink` conserva sus clases pero con tokens ya sweepeados (`bg-background`, `text-muted-foreground`, `hover:bg-background/60`, `hover:text-foreground`).
  - Grupo de BDs con Collapsible (Radix pone `aria-expanded` solo):

```tsx
<Collapsible open={dbsOpen} onOpenChange={setDbsOpen}>
  <CollapsibleTrigger asChild>
    <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-background/60 hover:text-foreground">
      <Database className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">Bases de datos</span>
      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${dbsOpen ? "rotate-90" : ""}`} />
    </button>
  </CollapsibleTrigger>
  <CollapsibleContent className="mt-1 space-y-1 pl-4">
    {DATABASES.map((db) => (
      <NavLink key={db.slug} href={`/db/${db.slug}/reports`} label={db.name}
               icon={<Table2 className="h-4 w-4 shrink-0" />} onNavigate={close} />
    ))}
  </CollapsibleContent>
</Collapsible>
```

  - Logout:

```tsx
<Button variant="outline" onClick={logout} disabled={loggingOut}
        className="w-full text-muted-foreground hover:border-danger hover:bg-transparent hover:text-danger">
  {loggingOut ? <Spinner className="h-3.5 w-3.5" /> : <LogOut className="h-4 w-4" />}
  {loggingOut ? "Saliendo…" : "Cerrar sesión"}
</Button>
```

- [ ] **Step 2: Gate + E2E**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run test:e2e`
Expected: PASS completo. Tests clave: smoke "sidebar can be unpinned, reopened and pinned again" y onboarding "el paso de navegación abre la sidebar…".

- [ ] **Step 3: Commit**

```bash
git add src/app/components/app-shell.tsx
git commit -m "refactor(shell): restiliza la sidebar con primitivas shadcn y lucide"
```

---

### Task 5: Login + menú principal

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle`, `Input`, `Button`, `Spinner`, lucide `Clock`, `MessageSquare`, `ChevronRight`.

- [ ] **Step 1: Reemplazar el form de login** (rama `!authed`) por:

```tsx
<main className="min-h-screen flex items-center justify-center p-6">
  <Card className="w-full max-w-sm">
    <form onSubmit={login} className="space-y-6">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-bold tracking-tight">ExportNotion</CardTitle>
        <CardDescription>Reportes y exportación de bases de Notion.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
               placeholder="Contraseña" autoFocus />
        {loginErr && <p className="text-sm font-medium text-danger">{loginErr}</p>}
      </CardContent>
      <CardFooter>
        <Button type="submit" disabled={loggingIn} className="w-full">
          {loggingIn && <Spinner />}
          {loggingIn ? "Entrando…" : "Entrar"}
        </Button>
      </CardFooter>
    </form>
  </Card>
</main>
```

- [ ] **Step 2: Tarjetas del menú.** Eliminar `ClockIcon`/`ChatIcon` a mano; `DB_ICONS.tiempos = <Clock className="h-5 w-5 shrink-0" />`. La tarjeta del Asistente y las de BD conservan estructura, textos, `data-tour` y hovers, cambiando el contenedor a `Card`:

```tsx
<Link href="/asistente" data-tour="menu-asistente" className="block">
  <Card className="flex flex-row items-center gap-4 p-5 transition hover:border-sky hover:bg-card/80">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue/15 text-sky">
      <MessageSquare className="h-5 w-5 shrink-0" />
    </span>
    <div className="min-w-0 flex-1">
      <h3 className="font-display text-lg font-bold text-foreground">Asistente IA</h3>
      <p className="text-sm text-muted-foreground">Pregunta en lenguaje natural sobre tus bases de datos.</p>
    </div>
    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
  </Card>
</Link>
```

Tarjeta de BD análoga (misma información: contador `text-sky tabular-nums`, "sync hace…", `data-tour="menu-db-card"` en el `Link` de la primera).

- [ ] **Step 3: Gate + E2E**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run test:e2e`
Expected: PASS. Tests clave: smoke login + "el botón ? corre el recorrido del menú…".

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor(menu): migra login y menú principal a Card/Input/Button shadcn"
```

---

### Task 6: Reportes — modals, filtros y MultiSelect

**Files:**
- Modify: `src/app/db/tiempos/reports/page.tsx` (modals, filtros, breadcrumb, Esc effects)
- Modify: `src/app/db/tiempos/reports/components.tsx` (nuevo MultiSelect; BarChart aún intacto)

**Interfaces:**
- Consumes: `AppModal` (Task 3), `Input`, `Button`, `Label`, `Separator`, `Popover*`, `Command*`, `Badge`, shadcn `Breadcrumb*`.
- Produces: `MultiSelect({ label, options: {value,label}[], selected: string[], onChange })` — mismo API que el actual.

- [ ] **Step 1: Nuevo `MultiSelect` en `components.tsx`** (reemplaza al actual; conservar `MultiSelectOption`):

```tsx
export function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline"
                className={`w-full justify-between px-3 font-normal ${selected.length ? "border-sky/60" : "text-muted-foreground"}`}>
          <span className="truncate">{label}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {selected.length > 0 && (
              <Badge variant="secondary" className="rounded-full px-1.5 font-medium text-sky">{selected.length}</Badge>
            )}
            <ChevronsUpDown className="h-3 w-3 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Buscar…" />
          <CommandList>
            <CommandEmpty>Sin coincidencias</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                  <Check className={`h-4 w-4 text-sky ${selected.includes(o.value) ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t border-border p-1">
              <Button variant="ghost" size="sm" onClick={() => onChange([])}
                      className="w-full justify-start font-normal text-muted-foreground">
                Limpiar selección
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

(Imports nuevos en `components.tsx`: `Badge`, `Button`, `Command*`, `Popover*`, `Check`, `ChevronsUpDown`. El `useEffect/useRef` del viejo dropdown se elimina.)

- [ ] **Step 2: En `page.tsx`, migrar los dos modals a `AppModal`.** Borrar la función local `Modal` y los dos `useEffect` de Escape (líneas de `if (!detail) return` y `if (!modal) return` — Radix maneja Esc). Export:

```tsx
<AppModal open={modal === "export"} onClose={() => setModal(null)} title="Exportar CSV" anchor="export-modal">
  <p className="text-sm text-muted-foreground">
    Rango opcional por fecha de creación. Con ambos campos vacíos se exporta todo el snapshot.
  </p>
  <div className="flex gap-3">
    <Label className="flex-1 flex-col items-start text-sm text-muted-foreground">Desde
      <Input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
    </Label>
    <Label className="flex-1 flex-col items-start text-sm text-muted-foreground">Hasta
      <Input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
    </Label>
  </div>
  <Button onClick={download} disabled={downloading} className="w-fit">
    {downloading && <Spinner className="h-3.5 w-3.5" />}
    {downloading ? "Descargando…" : "Descargar"}
  </Button>
  {downloadErr && <p className="text-sm font-medium text-danger">{downloadErr}</p>}
</AppModal>
```

Sync: mismo traslado 1:1 del contenido actual dentro de `<AppModal open={modal === "sync"} … title="Sincronización" anchor="sync-modal">`; los `border-t border-border pt-…` interiores pueden pasar a `<Separator />` + spacing; los botones: "Refrescar incremental" → `<Button>`, "Full" → `<Button variant="outline">`, "Cancelar y guardar lo cargado" → `<Button variant="outline" className="border-danger text-danger hover:bg-danger hover:text-white">`. Textos y estados (`triggering`, `cancelling`, contadores) EXACTAMENTE iguales.

- [ ] **Step 3: Filtros.** Fechas con `Label`+`Input type="date"` (mismos `min`/`max`/handlers). Los cuatro `MultiSelect` no cambian de invocación. El `inputCls` compartido desaparece (lo cubre `Input`).

- [ ] **Step 4: Breadcrumb.** Sustituir `<Breadcrumb items={…} />` custom por el de shadcn:

```tsx
<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink asChild><Link href="/">Menú</Link></BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>BD Tiempos</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

Botones del snapshot: "Exportar" → `<Button variant="outline">`, "Sincronizar" → `<Button>`.

- [ ] **Step 5: Gate + E2E**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run test:e2e`
Expected: PASS. Tests clave: smoke "sync/export modals work" (Esc + click en backdrop `div.fixed.inset-0`), "reports page renders filters" (botones "Persona"/"Subproyecto"), onboarding "el recorrido de reportes abre y cierra los modals por su cuenta", "Esc en un paso que abrió un modal cierra ambos", "Atrás desde el paso de sync…".

⚠️ Si el click de "Siguiente" del tour cerrara el modal antes de tiempo (pointerdown-outside de Radix) el propio flujo del tour lo reabre en el paso siguiente; los E2E validan el resultado neto. Si un test falla aquí, revisar `onInteractOutside`/`onOpenAutoFocus` del `DialogContent` antes de tocar el motor del tour (que está prohibido).

- [ ] **Step 6: Commit**

```bash
git add src/app/db/tiempos/reports
git commit -m "refactor(reports): modals a AppModal y MultiSelect a Popover+Command"
```

---

### Task 7: Reportes — totales, gráfica Recharts y tablas

**Files:**
- Modify: `src/app/db/tiempos/reports/page.tsx` (totales, timeline, matriz, agregados, detalle)
- Modify: `src/app/db/tiempos/reports/components.tsx` (TimelineChart reemplaza a BarChart)

**Interfaces:**
- Consumes: `Card`, `Skeleton`, `Tabs*`, `Table*`, `ChartContainer`, `ChartTooltip`, tipo `ChartConfig`, Recharts (`BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`), `AppModal`.
- Produces: `TimelineChart({ buckets, granularity, onBarClick? })` — reemplaza a `BarChart` (mismo contrato semántico).

- [ ] **Step 1: `TimelineChart` en `components.tsx`** (borrar `BarChart` SVG y sus constantes `W/H/PAD_*`; conservar `bucketLabel` y `fmtHours`):

```tsx
const chartConfig = {
  hours: { label: "Horas", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function TimelineChart({ buckets, granularity, onBarClick }: {
  buckets: TimelineBucket[];
  granularity: "month" | "week";
  onBarClick?: (bucket: string) => void;
}) {
  if (!buckets.length) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Sin registros en el rango seleccionado.</p>;
  }
  // etiquetas X: máx ~12 para no encimar (mismo criterio del SVG previo)
  const every = Math.ceil(buckets.length / 12);
  return (
    <ChartContainer config={chartConfig} className="h-60 w-full"
                    aria-label={`Horas por ${granularity === "month" ? "mes" : "semana"}`}>
      <BarChart data={buckets} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={10}
               interval={every - 1} tickFormatter={(v: string) => bucketLabel(v, granularity)} />
        <YAxis tickLine={false} axisLine={false} width={46} fontSize={10}
               tickFormatter={(v: number) => fmtHours(v)} />
        <ChartTooltip cursor={{ fill: "var(--border)", opacity: 0.35 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as TimelineBucket;
            return (
              <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl">
                <p className="font-medium text-foreground">{bucketLabel(d.bucket, granularity)}</p>
                <p className="font-semibold text-sky">{fmtHours(d.hours)} h</p>
                <p className="text-muted-foreground">{d.count} registros</p>
                {onBarClick && <p className="mt-1 text-muted-foreground">Click para ver el detalle</p>}
              </div>
            );
          }} />
        <Bar dataKey="hours" fill="var(--color-hours)" radius={[4, 4, 0, 0]} maxBarSize={48}
             className={onBarClick ? "cursor-pointer" : undefined}
             onClick={(data: unknown) => {
               const bucket = (data as { bucket?: string })?.bucket;
               if (bucket) onBarClick?.(bucket);
             }} />
      </BarChart>
    </ChartContainer>
  );
}
```

(En Recharts, el primer argumento del `onClick` de `<Bar>` es el datum con las props originales — incluye `bucket`.)

- [ ] **Step 2: Sección de timeline en `page.tsx`.** Import `BarChart` → `TimelineChart` (misma invocación). Toggle Semana/Mes con Tabs:

```tsx
<Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
  <TabsList>
    <TabsTrigger value="week">Semana</TabsTrigger>
    <TabsTrigger value="month">Mes</TabsTrigger>
  </TabsList>
</Tabs>
```

- [ ] **Step 3: Totales con Card + Skeleton:**

```tsx
<section data-tour="reports-totals" className="grid grid-cols-3 gap-4">
  {[…mismo array…].map((t) => (
    <Card key={t.label} className="gap-1 p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
      {loading
        ? <Skeleton className="mt-1 h-8 w-24" />
        : <p className="mt-1 font-display text-2xl font-bold text-sky">{t.value}</p>}
    </Card>
  ))}
</section>
```

- [ ] **Step 4: Tablas con componentes `Table`.** `AggTable` y la matriz conservan TODA su lógica (heatBg inline, `mutedFirst`, sticky, `[overflow-wrap:anywhere]`, onClick de fila) cambiando etiquetas: `<table>`→`<Table>`, `<thead>`→`<TableHeader>`, `<tbody>`→`<TableBody>`, `<tr>`→`<TableRow>`, `<th>`→`<TableHead>`, `<td>`→`<TableCell>`, trasladando las clases actuales (las de shadcn se combinan; el `hover:bg-background/50` de filas clickeables se conserva). El `sticky left-0 bg-card` de la matriz y el `sticky top-0 bg-card` del thead se mantienen.

- [ ] **Step 5: Panel de detalle → `AppModal wide`.** Reemplazar el overlay/manual por:

```tsx
{detail && (
  <AppModal open onClose={() => setDetail(null)} title={detail.title} wide>
    {detail.loading && detail.rows.length === 0
      ? <div className="flex justify-center py-10"><Spinner className="text-sky" /></div>
      : detail.rows.length === 0
        ? <p className="py-8 text-center text-sm text-muted-foreground">Sin registros para este corte.</p>
        : (…la misma tabla, con componentes Table como en Step 4…)}
    {detail.nextCursor && (
      <div className="pt-2 text-center">
        <Button variant="outline" disabled={detail.loading}
                onClick={() => { setDetail({ ...detail, loading: true }); void loadDetailPage({ ...detail, loading: true }); }}>
          {detail.loading ? "Cargando…" : "Cargar más"}
        </Button>
      </div>
    )}
  </AppModal>
)}
```

- [ ] **Step 6: Gate + E2E**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run test:e2e`
Expected: PASS. Tests clave: smoke "reports page renders filters and empty state" (`Sin registros en el rango seleccionado.` lo emite ahora `TimelineChart`).

- [ ] **Step 7: Commit**

```bash
git add src/app/db/tiempos/reports
git commit -m "refactor(reports): totales, gráfica Recharts y tablas shadcn"
```

---

### Task 8: Asistente IA (Select, Textarea, Sheet)

**Files:**
- Modify: `src/app/asistente/page.tsx`
- Modify: `tests/e2e/smoke.spec.ts` (roles del composer)

**Interfaces:**
- Consumes: `Select*`, `Textarea`, `Button`, `Sheet*`, shadcn `Breadcrumb*`, lucide `Menu`, `Plus`, `Trash2`, `X`.

- [ ] **Step 1: Composer.** Eliminar el prop/render `openUp` (Radix posiciona solo) y el import de `Dropdown`:

```tsx
const composer = (
  <div data-tour="chat-composer"
       className="rounded-2xl border border-border bg-background transition focus-within:border-blue focus-within:ring-2 focus-within:ring-blue/30">
    <Textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
              rows={1} disabled={noProvider} placeholder="Escribe tu pregunta…"
              className="max-h-40 min-h-[48px] resize-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0 [color-scheme:dark]" />
    <div data-tour="chat-selectors" className="flex items-center gap-2 px-2.5 pb-2.5">
      <Select value={db} onValueChange={setDb}>
        <SelectTrigger size="sm" aria-label="Base de datos" className="w-auto rounded-full bg-card text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {dbOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={provider || undefined} onValueChange={setProvider} disabled={noProvider}>
        <SelectTrigger size="sm" aria-label="Modelo" className="w-auto rounded-full bg-card text-xs">
          <SelectValue placeholder="— sin modelo —" />
        </SelectTrigger>
        <SelectContent>
          {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={() => void send()} disabled={sending || noProvider || !input.trim()}
              className="ml-auto rounded-full">
        {sending ? <Spinner className="h-4 w-4" /> : "Enviar"}
      </Button>
    </div>
  </div>
);
```

⚠️ Radix `SelectItem` prohíbe `value=""` — por eso la rama `noProvider` va por `placeholder` y NO por un item vacío (borrar `providerOptions`; usar `providers` directo). Ambos usos de `renderComposer(...)` pasan a usar `composer`.

- [ ] **Step 2: Historial.** Extraer el contenido del panel a una constante `historyPanel` (botón "Nuevo chat" → `<Button className="flex-1"><Plus className="h-4 w-4" />Nuevo chat</Button>`, items con sus clases actuales, borrar → `Button variant="ghost" size="icon"` + `Trash2 h-3.5 w-3.5`, aria-label "Borrar chat"). Renderizarla dos veces:
  - Desktop: `<aside data-tour="chat-history" className="hidden w-64 shrink-0 flex-col border-r border-border bg-background md:flex">{historyPanel}</aside>` (columna estática; ya no necesita transform).
  - Móvil: `<Sheet open={drawerOpen} onOpenChange={setDrawerOpen}><SheetContent side="left" className="w-64 bg-background p-0">{historyPanel}</SheetContent></Sheet>`. El `useEffect` de Esc del drawer y el backdrop manual se borran (Radix los cubre); el botón "Cerrar historial" manual también (SheetContent trae X).
- [ ] **Step 3: Breadcrumb** shadcn (como en Task 6, con "Asistente IA" como `BreadcrumbPage`). Botón hamburguesa del historial (`aria-label="Historial de chats"`) → `Button variant="outline" size="icon"` + `Menu h-4 w-4`, visible sólo `md:hidden`.

- [ ] **Step 4: Actualizar `tests/e2e/smoke.spec.ts`** — test "chat page renders composer and model selector", los dos últimos expects:

```ts
// Selects de shadcn/Radix dentro del cuadro de texto (rol combobox).
await expect(page.getByRole("combobox", { name: "Modelo" })).toBeVisible();
await expect(page.getByRole("combobox", { name: "Base de datos" })).toBeVisible();
```

- [ ] **Step 5: Gate + E2E**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run test:e2e`
Expected: PASS. Tests clave: smoke chat + onboarding "el recorrido del asistente cubre compositor, selectores e historial".

- [ ] **Step 6: Commit**

```bash
git add src/app/asistente/page.tsx tests/e2e/smoke.spec.ts
git commit -m "refactor(asistente): composer con Select/Textarea shadcn e historial en Sheet"
```

---

### Task 9: Restilizar tour popover y bienvenida

**Files:**
- Modify: `src/app/components/tour/tour-popover.tsx`
- Modify: `src/app/components/tour/welcome.tsx`
- NO tocar: `tour-layer.tsx`

**Interfaces:**
- Consumes: `Button`, lucide `X`.
- Produces: mismos testids (`tour-popover`, `tour-progress`, `welcome-modal`, `welcome-banner`) y textos de botones ("Siguiente", "Atrás", "Terminar", "Continuar en …", "Empezar", "Ahora no", "Iniciar tutorial").

- [ ] **Step 1: `tour-popover.tsx`** — conservar posicionamiento, z-index `z-[57]` y estructura; sustituir los `<button>` a mano por `Button` (`size="sm"`: "Siguiente"/"Terminar"/"Continuar en…" → variante default; "Atrás" → `variant="ghost"`; cierre X → `variant="ghost" size="icon"` con `<X className="h-4 w-4" />`). Mantener cualquier lógica de foco/teclado tal cual (React 19 pasa `ref` a `Button` sin forwardRef).

- [ ] **Step 2: `welcome.tsx`** — ⚠️ NO convertir a Radix Dialog: el E2E fija el foco inicial en "Empezar" y el ciclo Tab/Shift+Tab del trap propio. Solo: contenedor con look de Card (`rounded-xl border bg-card p-6 shadow-lg`), botones → `Button` ("Empezar" default, "Ahora no" `variant="outline"`, banner "Iniciar tutorial" `variant="outline" size="sm"`). El z-index `z-[58]` y los testids no cambian.

- [ ] **Step 3: Gate + E2E**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run test:e2e`
Expected: PASS completo — onboarding.spec.ts entero es el test de esta tarea (incluye "el modal de bienvenida atrapa el foco").

- [ ] **Step 4: Commit**

```bash
git add src/app/components/tour
git commit -m "refactor(tour): restiliza popover y bienvenida con Button/Card del tema"
```

---

### Task 10: Limpieza, docs y verificación final

**Files:**
- Delete: `src/app/components/dropdown.tsx`, `src/app/components/breadcrumb.tsx`
- Modify: `CLAUDE.md`, `docs/to-dos.md` si aplica

- [ ] **Step 1: Borrar componentes muertos** y verificar que nada los importa:

Run: `rg "components/dropdown|components/breadcrumb" src tests`
Expected: sin resultados. Luego `git rm src/app/components/dropdown.tsx src/app/components/breadcrumb.tsx`.

- [ ] **Step 2: Actualizar `CLAUDE.md`** — en "Páginas (UI)" agregar un bullet: la UI usa shadcn/ui (Tailwind v4 + CSS variables, dark fijo tematizado con la paleta iU en `globals.css`; primitivas en `src/components/ui/`, código propio ajustable; `AppModal` = Dialog no-modal porque el tour necesita clickear su popover con modals abiertos; el shell conserva su máquina de estados anclada/overlay — el Sidebar de shadcn no la soporta).

- [ ] **Step 3: Verificación final completa**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run test:e2e && npm run build`
Expected: todo PASS, build sin warnings nuevos.

- [ ] **Step 4: Revisión visual** — levantar `npm run dev` (después del build E2E, borra `.next` si el dev server da 404 fantasma — ver memoria del repo) y recorrer: login → menú → reportes (filtros, gráfica, drill-down, modals export/sync) → asistente (selects, historial) → tour completo con "?" en las tres páginas. Confirmar contraste y que nada quedó con fondo/texto ilegible.

- [ ] **Step 5: Commit + cierre**

```bash
git add -A
git commit -m "chore(ui): limpia componentes muertos y documenta shadcn en CLAUDE.md"
```

Después: mostrar `git diff main...feat/shadcn-ui --stat` al usuario, correr `/code-review` sobre el diff, reportar hallazgos de corrección, y abrir el PR con `gh pr create` (qué cambia, por qué, cómo verificarlo).

---

## Self-review del plan (hecho)

- **Cobertura del spec:** infra (T1), tema (T2), primitivas+AppModal (T3), shell propio restilizado (T4), login/menú (T5), reportes completos incl. gráfica y MultiSelect (T6–7), asistente incl. cambio combobox del smoke (T8), tour restyle sin tocar el motor (T9), limpieza+docs (T10). Fechas nativas: T6 usa `Input type="date"` (decisión del spec).
- **Sin placeholders:** cada paso tiene código o comando concreto; los traslados "1:1" referencian contenido existente que el ejecutor tiene en el archivo.
- **Consistencia de tipos:** `MultiSelect` y `TimelineChart` conservan las firmas que `page.tsx` ya usa; `AppModal` se define en T3 y se consume en T6–7 con la misma firma; `Spinner({className})` intacto.
