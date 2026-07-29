# Migración de la UI a shadcn/ui con tema iU Corp

**Fecha:** 2026-07-29 · **Rama:** `feat/shadcn-ui` · **Estado:** aprobado por Pablo

## Objetivo

Reemplazar los componentes de UI hechos a mano por componentes de shadcn/ui,
tematizados con la paleta dark del brandbook de iU Corp. La estética adopta el
look de shadcn (radios, focus rings, animaciones de Dialog/Popover); el layout
general de cada página no cambia. Cero cambios de lógica de datos.

## Decisiones tomadas (con el usuario, 2026-07-29)

1. **Tipografía:** se mantiene el par del brandbook — Raleway (display,
   700/800) + Poppins (sans, 400/500/600). La nota vieja sobre "Inter única"
   queda descartada.
2. **Alcance:** todo, incluida la gráfica (`BarChart` SVG → shadcn Charts
   sobre Recharts) y el `MultiSelect` (→ Popover + Command).
3. **Estética:** shadcn + colores iU (no réplica pixel-perfect de lo actual,
   no rediseño de layouts).
4. **Estrategia:** una sola rama `feat/shadcn-ui` con commits pequeños y un
   único PR.

## 1. Infraestructura

- `npx shadcn@latest init` en modo **Tailwind v4 + CSS variables**. Genera
  `components.json`, `src/lib/utils.ts` (`cn()`) y `src/components/ui/`
  (compatible con el alias `@/*` → `src/*`).
- Dependencias nuevas: paquetes Radix que traigan los componentes instalados,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`,
  `lucide-react`, `recharts`. Nada más.
- Los componentes instalados por la CLI se commitean como código propio y se
  pueden ajustar al tema.

## 2. Tema (`src/app/globals.css`)

- **Dark fijo, sin toggle y sin clase `.dark`**: los tokens de shadcn se
  definen una sola vez en `:root` con la paleta iU:

  | Token shadcn | Valor iU |
  |---|---|
  | `--background` | `#051758` (Unique Dark Blue) |
  | `--card`, `--popover` | `#0A2468` (surface) |
  | `--border`, `--input` | `#1C3C84` |
  | `--foreground`, `--card-foreground`, `--popover-foreground` | `#F4F4F4` |
  | `--muted-foreground` | `#9A9A9A` |
  | `--primary` / `--primary-foreground` | `#0F40EF` / blanco |
  | `--destructive` | `#F05347` |
  | `--ring` | `#0F40EF` |
  | `--chart-1` | `#02B5D3` (sky — serie de datos) |

- Los tokens de marca existentes en `@theme` (`bg-surface`, `text-sky`,
  `text-muted`, etc.) **se conservan** para acentos (cifras en sky, heatmap) y
  para no reescribir todos los callsites de golpe.
- Tipografía y tamaños actuales intactos; scrollbars custom se quedan.

## 3. Componentes shadcn a instalar

`button`, `card`, `input`, `textarea`, `label`, `dialog`, `sheet`, `table`,
`popover`, `command`, `select`, `breadcrumb`, `collapsible`, `tabs`,
`sidebar`, `chart`, más tres con uso puntual: `badge` (contador del
MultiSelect), `separator` (divisores en modals y sidebar) y `skeleton`
(estados de carga de tarjetas de totales y tablas, en lugar del "…" actual).
Si al implementar alguno no encuentra uso, no se instala.

## 4. Mapeo por pieza

| Hoy | Después |
|---|---|
| Botones/inputs a mano | `Button` (default/outline/ghost/destructive), `Input`, `Textarea` |
| `Modal` custom (export/sync) y panel de detalle de reportes | `Dialog` (el detalle con `max-w-4xl` y scroll interno) |
| `MultiSelect` custom (filtros de reportes) | `Popover` + `Command` con checkboxes: búsqueda, contador de seleccionados y "Limpiar selección" — misma UX |
| `Dropdown` custom del composer del asistente | `Select` de shadcn (Radix decide dirección de apertura; desaparece el prop `openUp`) |
| `BarChart` SVG a mano | `ChartContainer` sobre Recharts: barras sky redondeadas, `ChartTooltip`, **se conserva el click-para-drill-down por barra** |
| Tablas a mano (agregados, matriz, detalle) | `Table`; el **heatmap se conserva** con estilos inline (`heatBg`) como hoy |
| Sidebar custom de `AppShell` | `Sidebar` de shadcn (`SidebarProvider`, `collapsible="offcanvas"`, `Collapsible` para el grupo de BDs; móvil = `Sheet` automático). La preferencia anclada/oculta persiste (shadcn usa cookie `sidebar_state` en lugar de la key `sidebar-pinned`) |
| `Breadcrumb` custom | `Breadcrumb` de shadcn |
| `Spinner` custom | `Loader2` de lucide + `animate-spin`, conservando el API del componente `Spinner` (no se tocan callsites) |
| SVGs inline de iconos | `lucide-react` (Clock, MessageSquare, Database, Home, Table2, LogOut, Menu, X, Pin, Plus, Trash2, ChevronRight…) |
| Toggle Semana/Mes | `Tabs` |
| Cajón móvil del historial de chats | `Sheet` |
| Tour: spotlight, popover, welcome | El **motor no se toca** (`tour-layer.tsx`: medición por frames, acciones por ref — tiene regresiones E2E). Sólo se restilizan `tour-popover.tsx` y `welcome.tsx` con Card/Button/Dialog del tema |

**Inputs de fecha:** siguen siendo nativos (`<input type="date">` con estilo
de `Input` + `[color-scheme:dark]`). El DatePicker de shadcn agrega
`react-day-picker` sin ganancia real aquí; queda fuera del alcance.

## 5. Invariantes

- Lógica de datos intacta: fetches, polling de sync, encadenado del full,
  drill-down, chat-store, auth.
- Atributos `data-tour="…"` se preservan en los elementos equivalentes.
- Keys de `localStorage`: `onboarding-v1` y `asistente-chats-v1` no cambian.
  (`sidebar-pinned` migra a la persistencia propia del Sidebar de shadcn.)
- Textos visibles sin cambios (los E2E los usan como selectores).
- Nada de logotipo/isotipo ni texto "iU Corporation" nuevos; dark fijo sin
  toggle.

## 6. Verificación

- Gate por hito: `npm test && npm run lint && npx tsc --noEmit`.
- `npm run test:e2e` (stubs) tras cada página migrada; `onboarding.spec.ts`
  es el canario del tour sobre los nuevos componentes.
- Revisión visual con `npm run dev` al cierre.

## 7. Plan de commits

En `feat/shadcn-ui`, en orden:

1. `chore(ui): instala shadcn/ui con tema dark iU` — init + tema + deps.
2. `feat(ui): agrega primitivas shadcn tematizadas` — componentes de la CLI.
3. `refactor(shell): migra AppShell al Sidebar de shadcn`.
4. `refactor(menu): migra login y menú principal a shadcn`.
5. `refactor(reports): migra reportes a shadcn (Dialog, Table, Chart, MultiSelect)`.
6. `refactor(asistente): migra el chat a shadcn (Select, Sheet, Textarea)`.
7. `refactor(tour): restiliza popover y bienvenida con el tema shadcn`.

Al final: `git diff` para revisión, `/code-review`, PR con `gh pr create`.
