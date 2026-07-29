# Onboarding guiado — Diseño

**Fecha:** 2026-07-29 · **Rama:** `feat/onboarding-guiado` · **Skill:** superpowers:brainstorming

## Objetivo

Guiar paso a paso a quien entra por primera vez a la app, y dejar un botón **"?"**
permanente que repite la guía de la pantalla en la que estés. Tras un inicio de
sesión siempre hay una vía visible para arrancar el recorrido.

## Decisiones tomadas

| Decisión | Elegido | Alternativa descartada |
|---|---|---|
| Mecánica | **Spotlight** sobre elementos reales (recorte + globo anclado) | Modal centrado tipo carrusel |
| Alcance | **Un tour por página** + encadenado opt-in al final de cada uno | Tour único de ~15 pasos que navega solo |
| Disparo | **Modal** el primer login del navegador, **tira discreta** en los siguientes | Modal en cada login; o sólo tira, nunca modal |
| Interactividad | El tour **abre los modals** (Exportar, Sincronizar) para explicarlos por dentro | Sólo señalar sin abrir; o tours propios dentro de cada modal |
| Motor | **Propio**, en el repo | `driver.js` |
| Botón "?" | **Flotante fijo arriba a la derecha** | Abajo a la derecha (choca con el compositor del chat); entrada en la sidebar (desaparece con la sidebar oculta) |

Sobre el motor propio: `driver.js` sólo resolvería máscara, posicionamiento del
globo y scroll-into-view. Las dos piezas que de verdad cuestan aquí —**acciones
por paso** (abrir/cerrar el modal de sync) y **encadenado entre páginas**— se
escriben igual con o sin librería. Pagar una dependencia para quedarse con la
mitad del problema, y además pelear con su CSS para respetar el brandbook, no
sale a cuenta en un repo con 11 dependencias donde ya se retiró `msw` por no
usarse (commit `fb03f54`).

## Arquitectura

### Piezas nuevas

```
src/lib/tour/
  types.ts       TourStep, TourScript, TourId, TourActionId (tipos, sin runtime)
  geometry.ts    puro: (rect del ancla, viewport, lado preferido) → posición del globo
  storage.ts     localStorage "onboarding-v1": hasSeenWelcome() / markWelcomeSeen()
  scripts.ts     los 3 guiones como datos + el registro TourId → TourScript
src/app/components/tour/
  tour-layer.tsx    motor: paso actual, acciones, teclado, recálculo en scroll/resize
  tour-popover.tsx  el globo (título, cuerpo, "3 / 7", Saltar / Atrás / Siguiente)
  welcome.tsx       modal de bienvenida + tira discreta
```

### Cómo se conecta: props, no contexto

`AppShell` es **hijo** de cada página (la página hace `<AppShell>…</AppShell>`),
así que un contexto declarado en el shell **no alcanzaría** al componente que
tiene el `setModal`. El tour entra por props, igual que el `onLogout` que ya
existe:

```tsx
// reports/page.tsx, rama autenticada
<AppShell onLogout={…}
          tour={{ id: "reports", actions: {
            openExportModal: () => setModal("export"),
            openSyncModal:   () => setModal("sync"),
            closeModal:      () => setModal(null),
          }}}>
```

`AppShell` agrega una sola línea (`<TourLayer tour={tour} …/>`) y aporta sus
propias acciones (`openSidebar` / `closeSidebar`), fusionadas con las de la
página. Una página que no pasa `tour` no tiene botón "?" ni overlay.

### El spotlight

Un `<div>` posicionado sobre el rect del ancla con
`box-shadow: 0 0 0 9999px rgba(5,23,88,.8)` —el mismo tono que el
`bg-dark-blue/80` de los modals existentes—: oscurece todo menos el recorte,
sin máscaras SVG. El recorte es transparente y deja ver lo que haya debajo, así
que ilumina elementos de cualquier `z-index` de la página — siempre que la capa
del tour quede **por encima de todas**: la sidebar overlay usa `z-50` y su
backdrop `z-40`, los modals `z-30`, así que blocker y recorte van sobre `z-50` y
el globo un nivel más arriba.

Las sombras **no capturan punteros**, así que debajo del recorte va un blocker a
pantalla completa con `pointer-events: auto` y el recorte encima con
`pointer-events: none`. Consecuencia deliberada: el elemento iluminado **no es
clickeable** durante el tour — el recorrido conduce, el usuario no puede disparar
un sync por accidente.

### El contrato de un paso

```ts
type TourId = "menu" | "reports" | "asistente";
type TourActionId = "openSidebar" | "closeSidebar"
                  | "openExportModal" | "openSyncModal" | "closeModal";

interface TourStep {
  anchor?: string;   // elemento con data-tour="<anchor>"; ausente = globo centrado
  title: string;
  body: string;      // texto plano, sin markdown (no arrastra react-markdown)
  side?: "top" | "bottom" | "left" | "right";  // preferencia; geometry voltea si no cabe
  before?: TourActionId;  // se ejecuta ANTES de anclar
  after?: TourActionId;   // al salir del paso en cualquier dirección, incluso al abortar
}

interface TourScript {
  id: TourId;
  steps: TourStep[];
  next?: { href: string; tour: TourId; label: string };  // encadenado opt-in
}
```

`after` es la garantía de limpieza: el motor guarda el `after` del paso vigente y
lo ejecuta al avanzar, retroceder, saltar, presionar Esc o terminar. **Un tour
abortado a la mitad no puede dejar un modal abierto.**

### Encadenado entre páginas

El último paso de un guión con `next` muestra un botón extra con `next.label` que
navega a `next.href?tour=<id>`. Al montar, `TourLayer` lee el parámetro desde
`window.location.search` dentro de un `useEffect` —no `useSearchParams()`, que en
Next 16 obliga a un `Suspense` para el prerender—, arranca ese tour si el `id`
coincide con el guión registrado, y limpia la URL con `router.replace`.

Encadenar es **decisión del usuario**: ningún tour cambia de ruta por su cuenta.

## Guiones

14 anclas `data-tour` en total (4 + 7 + 3; dos pasos van centrados sin ancla). El
botón de encadenado va en el último paso; no hay pasos de cierre dedicados.

### `menu` — 5 pasos · encadena a `reports`

| # | Ancla | Contenido |
|---|---|---|
| 1 | — (centrado) | Qué es la app: no consulta Notion en vivo, sirve todo desde una copia que se refresca sola una vez al día. |
| 2 | `menu-asistente` | Preguntar en español; responde consultando los mismos reportes. |
| 3 | `menu-db-card` | El número son los registros de la copia y hace cuánto se sincronizó; la tarjeta entra a los reportes. |
| 4 | `shell-sidebar` | Navegación, anclar/desanclar y cerrar sesión. `before: openSidebar` / `after: closeSidebar`. |
| 5 | `help-button` | Este "?" repite la guía de la pantalla en la que estés. |

El menú puede listar varias BDs cuando crezca `src/lib/databases.ts`. Para no
dejarlo indefinido: el ancla `menu-db-card` va en la **primera** tarjeta de
`DATABASES`, y `menu.next.href` se deriva de `DATABASES[0].slug` en vez de
hardcodear `/db/tiempos/reports`.

### `reports` — 7 pasos · encadena a `asistente`

| # | Ancla | Contenido |
|---|---|---|
| 1 | `reports-snapshot` | Registros y última sincronización; en 0 hay que sincronizar antes de exportar. |
| 2 | `reports-filters` | Rango + Persona/Subproyecto/Proyecto/Empresa: todos opcionales y combinables. Menciona que con **exactamente una** persona o subproyecto aparece la matriz por semana. |
| 3 | `reports-totals` | Horas, registros y personas activas **del corte vigente**, no del total. |
| 4 | `reports-timeline` | Semana vs. mes; click en una barra abre los registros del periodo. |
| 5 | `reports-tables` | Orden descendente, mapa de calor, click en fila para el detalle; "(sin persona)" agrupa lo que no tiene relación en Notion y no es clickeable. |
| 6 | `export-modal` | `before: openExportModal` / `after: closeModal`. Rango por fecha de creación; vacío = todo el snapshot. |
| 7 | `sync-modal` | `before: openSyncModal` / `after: closeModal`. Incremental = sólo lo editado (segundos); Full = reconstruye todo (minutos, sólo manual); la cuenta regresiva es el próximo automático. |

### `asistente` — 4 pasos · sin encadenado

| # | Ancla | Contenido |
|---|---|---|
| 1 | `chat-composer` | Pregunta libre; el modelo no adivina, consulta las funciones de reporte. |
| 2 | `chat-selectors` | Sobre qué base y con qué modelo; "— sin modelo —" significa que falta configurarlo. |
| 3 | `chat-history` | Los chats viven en **este navegador**, no en el servidor. |
| 4 | — (centrado) | Cómo verificar: el desplegable "consultó N herramienta(s)" de cada respuesta; si no aparece, el modelo contestó sin datos. |

**Por qué la matriz no tiene paso propio:** su sección sólo se renderiza con
exactamente una persona o un subproyecto seleccionado, así que un paso anclado
ahí se omitiría casi siempre. Se explica en el paso 2 de `reports`.

## Disparo tras iniciar sesión

En `/`, `justLoggedIn` es estado local que sólo pasa a `true` tras un
`POST /api/login` exitoso. **Un F5 con la cookie viva no cuenta** como inicio de
sesión.

| Condición | Resultado |
|---|---|
| `justLoggedIn && !hasSeenWelcome()` | Modal de bienvenida ([Ahora no] / [Empezar]) |
| `justLoggedIn && hasSeenWelcome()` | Tira discreta con "Iniciar tutorial" y ✕, arriba del contenido del menú |
| Siempre, en las tres páginas | Botón "?" flotante |

Al mostrar el modal se marca `welcomeSeen`, **incluso si eligen "Ahora no"**: la
promesa es "una vez por navegador". El descarte de la tira es estado local sin
persistir — cada login la vuelve a mostrar, que es lo pedido.

El login sólo ocurre en `/` (las otras páginas muestran "Ir al inicio de
sesión"), así que la lógica de bienvenida vive únicamente en la página del menú.

## Bordes resueltos

- **Ancla ausente** → el paso se omite y en dev se emite un `console.warn`.
- **El ancla desaparece a media explicación** (cerraron el modal con click fuera)
  → corre el `after` pendiente y salta al siguiente paso con ancla viva; si no
  queda ninguno, termina limpio.
- **Sync en curso**: el modal de sync muestra la vista de progreso sin los
  botones, así que el paso 7 se ancla al **cuerpo del modal**, no al botón, y el
  texto cubre ambos estados.
- **Esc**: el listener del tour se registra en **fase de captura** y detiene la
  propagación, para que Esc cierre el tour sin cerrar además el modal que el tour
  abrió (reportes ya tiene sus propios listeners de Esc).
- **Click en la zona oscura no cierra**: salir es explícito (Saltar, ✕ o Esc), y
  así nadie pierde el recorrido por un click distraído.
- **Foco**: al abrir el globo va a "Siguiente"; Tab circula sólo entre sus
  botones; al cerrar vuelve al "?". El globo es `role="dialog"` con
  `aria-modal` y `aria-labelledby`.
- **Scroll y resize**: `scrollIntoView({ block: "center" })` antes de medir, y
  recálculo del rect en `scroll`/`resize` con `requestAnimationFrame`. Los pasos
  se anclan a **secciones**, no a filas de tabla, para no depender del scroll
  interno de los contenedores `max-h-96 overflow-y-auto`.
- **Móvil** (<640px): el globo va a ancho completo al pie, no junto al ancla.
- **`prefers-reduced-motion`**: recorte sin transición.
- **Ninguna acción destructiva**: el tour sólo abre y cierra modals y la sidebar.
  Nunca dispara "Refrescar incremental", "Full" ni "Descargar".

## Pruebas

**Unit (vitest)**

- `geometry`: voltea de abajo a arriba cuando no cabe, se acota al viewport,
  centra cuando no hay ancla.
- `storage`: `welcomeSeen`, JSON corrupto, `localStorage` ausente, cuota agotada
  — mismo patrón tolerante que `src/lib/chat-store.ts`.
- `scripts`: todo paso tiene título y cuerpo no vacíos; `next.tour` existe en el
  registro; las anclas no se repiten dentro de un guión; todo `before` que abre
  algo declara su `after`.

**E2E (Playwright con stubs) — `tests/e2e/onboarding.spec.ts`**

Login → modal de bienvenida → Empezar → el contador del menú llega a **5 / 5** →
encadena a reportes → los 7 pasos, verificando que el modal de export y el de
sync se abren y se cierran solos → Esc → el "?" reinicia el tour de la página.
Más un caso de segundo login (logout → login) que espera la tira discreta y no el
modal.

**El contador "n / N" es la aserción clave**: si un paso se hubiera omitido por
ancla faltante, el conteo no cuadra. Es lo que impide que un `data-tour` borrado
por accidente en un refactor pase inadvertido, y la razón por la que los guiones
pueden vivir centralizados en `src/lib/tour/scripts.ts` en vez de junto a cada
página.

## Fuera de alcance

- **No** se reescribe `docs/guides/manual-usuario.md`, que está desactualizado
  (describe el dashboard viejo, ya fusionado con reportes, y un cron full que ya
  no existe). El onboarding lo cubre parcialmente; la reescritura se registra
  como pendiente en `docs/to-dos.md`.
- **No** hay tours dentro de los modals: el paso del tour de página los explica
  por dentro y con eso basta.
- **No** hay persistencia por usuario: no existe identidad en la app (un solo
  password compartido), así que "sesión nueva" sólo puede distinguirse por
  navegador vía `localStorage`, igual que los chats del Asistente y la
  preferencia `sidebar-pinned`.

## Documentación a actualizar al implementar

- `CLAUDE.md` — subsección del tour bajo *Páginas (UI)*.
- `docs/00-index.md` — línea de este spec.
- `docs/to-dos.md` — pendiente de reescribir el manual de usuario.
