# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git — flujo obligatorio

Toda sesión que modifique código sigue estas reglas, sin excepciones y sin que haga falta recordarlas:

- Git workflow: @docs/instruccionesGit.md

Equivalencias con los scripts reales de este repo (no hay `npm run typecheck`):

```bash
npm test              # vitest run
npm run lint          # eslint .
npx tsc --noEmit      # typecheck (no hay script npm)
```

En Windows el `&&` funciona igual en PowerShell 7+; para el gate previo a dar algo por terminado:
`npm test && npm run lint && npx tsc --noEmit`.

## Comandos

```bash
npm run dev              # Next dev server
npm run build            # build de producción
npm run lint             # eslint (next lint)
npm test                 # vitest run (unit + integration; lleva --passWithNoTests: un filtro sin matches pasa en silencio)
npm run test:watch       # vitest watch
npx vitest run tests/unit/flatten.test.ts   # un solo archivo
npx vitest run -t "nombre del test"          # filtrar por nombre
npm run test:e2e         # Playwright smoke — por defecto con stubs en memoria (E2E_STUBS=1), sin Postgres/Notion reales
E2E_REAL=1 npm run test:e2e   # contra el server real del puerto 3000 con .env.local
supabase db push         # aplica supabase/migrations/ a la base cloud (requiere `supabase link` previo)
TEST_DATABASE_URL="postgresql://…:6543/postgres" npx vitest run tests/integration/db.pg.test.ts   # SQL real (skipped sin la var)
```

> **No hay Postgres local** (ADR-0007, 2026-07-28): local y producción usan la **misma** base de
> Supabase Cloud, así que `npm run dev` escribe donde ven los colaboradores y un Full local
> reconstruye el snapshot de producción. `supabase/` sobrevive **sólo** como fuente de migraciones.
> ⚠️ `TEST_DATABASE_URL` debe ser un **proyecto Supabase dedicado a tests**: `db.pg.test.ts` dropea
> y trunca tablas (una corrida contra la base real borró el snapshot de 21k filas el 2026-07-13).
> Tiene dos guardas: aborta si la URL coincide con `DATABASE_URL` y si el destino ya tiene filas
> en `pages`.

> El E2E stub levanta su propio server (`next build` + `next start`, puerto 3100; `next dev` tiene lock por proyecto en Next 16). Stubs: `src/lib/memory-store.ts` (implementación en memoria de la interfaz `Store` de `db.ts`, activada por `E2E_STUBS=1` — cubre datos y rate-limit del login) y `GET /api/auth/stub-login`, que sólo existe con la bandera. ⚠️ `next start` (16.2.6) pisa el `process.env` heredado con `.env.local` (verificado empíricamente 2026-07-06, contra lo que dice la doc) — sólo pasan limpias las vars que `.env.local` no define, como `E2E_STUBS`.
>
> ⚠️ **`npm run test:e2e` con `npm run dev` abierto corrompe `.next`** (visto 2026-08-06): el `next build` del webServer escribe en el mismo `.next/` que usa el dev server, y los chunks stale de Turbopack quedan apuntando a módulos que el manifest ya no encuentra — el síntoma es `MODULE_UNPARSABLE` al cargar `src/instrumentation.ts` (el archivo está intacto). Arreglo: cortar el dev server, `Remove-Item .next -Recurse -Force` y volver a `npm run dev`. El E2E usa otro puerto pero **no** otro directorio de build.
>
> ⚠️ En máquinas cargadas los 4 workers default dan **falsos rojos** por timeout (el `login()` de `helpers.ts` no ve el shell en 5s y las navegaciones del onboarding no llegan): la misma suite pasa con `npm run test:e2e -- --workers=2`. Antes de investigar un rojo del E2E, reproducirlo con menos workers.

## Arquitectura

Webapp Next.js 16 (App Router) que sirve **CSV bajo demanda** desde un **snapshot en Postgres (Supabase Cloud)** de una base de Notion (ADR-0006 eligió Postgres; ADR-0007 lo dejó **cloud-only**: la misma base en local y en Vercel, sin Postgres local). El export NO consulta Notion en vivo — todo pasa por el snapshot, que se rellena con crons. Los reportes consultables (spec `docs/reports/202607081002_reportes_v1_spec.md`) se sirven con SQL sobre el mismo snapshot.

### Flujo de datos

```
Notion ──(cron sync)──► Postgres tabla `pages` ──┬─(GET /api/export)──► CSV stream
                                                 ├─(GET /api/reports/*)─► agregados SQL
                                                 └─(POST /api/chat)─────► LLM + tool-calling
```

- **`src/lib/sync.ts`** orquesta `runSync(kind)` con un **lock en Postgres** (`acquireLock` TTL 600s, fila en `sync_state` retomable al vencer). Devuelve `SyncResult`: `{ok, done:true, upserted, deleted}` o `{ok, done:false, segmentCount}` (sólo full con presupuesto). Dos modos:
  - `incremental`: **dos queries** a Notion con filtro `last_edited_time > lastIncrementalAt - 60s` (OVERLAP_MS): una de vivas (upsert) y una de papelera con `is_archived: true` (delete). No hay forma de traer ambas en una sola query — ver *notion.ts*. `lastIncrementalAt` se captura **antes** del fetch (las ediciones durante el sync caen en la próxima ventana) y **no avanza si el sync fue cancelado**. Siempre devuelve `done:true`.
  - **Contadores de sesión (FX-006, 2026-07-28)**: `processed`/`skipped` pertenecen a la **sesión**, no a la invocación. Al reanudar un full encadenado se siembran desde `getStatus()` (el status se persiste sin TTL); si no, cada tramo reescribía `done` desde 0 y la UI mostraba el progreso reiniciándose. El total que se reporta al terminar es `countRowsNew()` — filas distintas del staging, que además no cuenta doble las páginas frontera que el pivote `on_or_before` re-trae.
  - `full`: construye el snapshot en la tabla staging `pages_new` con **upsert progresivo por batch (≤100) y checkpoint de pivote por batch**. Una "sesión" de full se marca con la key `full:active` de `sync_state` (valor = startedAt): ausente = sesión nueva (trunca staging y limpia pivote); presente = **reanudación** — una función muerta a mitad ya NO pierde el avance. Sin `SYNC_BUDGET_MS` la invocación corre hasta terminar; con presupuesto corta a tiempo con checkpoint y devuelve `done:false` para que el cliente encadene. Promueve `pages_new` → `pages` con **swap transaccional** (TRUNCATE + INSERT…SELECT, mismo efecto que el viejo RENAME de Redis) al completar o cancelar; si Notion devuelve 0 páginas en total, no promueve. Al promover, `lastIncrementalAt = startedAt de la sesión` (no el final): lo editado durante el full entra en la ventana del próximo incremental.
- **`src/lib/notion.ts`** usa `@notionhq/client` **v5** con `dataSources.query` (no `databases.query`). `NOTION_DATABASE_ID` debe ser un **Data Source ID**, no el database ID antiguo — obtenerlo via `GET /v1/databases/<id>` → `data_sources[0].id` (header `Notion-Version: 2025-09-03`). Throttle 3 req/s, retry con backoff y respeto de `retry-after`.
  - **Notion limita CUALQUIER query a 10,000 resultados**, incluso paginando con cursor. Para datasets más grandes, full sync se segmenta por `created_time` DESC con filtro `on_or_before: pivote` recursivo.
  - `fetchPages` (incremental): dos queries. ⚠️ En la versión de API `2025-09-03`, `is_archived` **particiona** (omitido = sólo vivas; `true` = sólo papelera) y `in_trash`/`archived` en el body dan `validation_error` 400 aunque los tipos del SDK los declaren (verificado contra el API real el 2026-07-06). Además el SDK v5.21 **descarta `is_archived` en silencio** (whitelist interna de body params), así que la query de papelera va por `client().request()` crudo.
  - `fetchFullBatches` (full): entrega batch por batch vía `onBatch(pages, lastCreatedTime, hasMore)` — ahí el caller persiste y fija checkpoint — y encadena internamente los segmentos del cap de 10k hasta agotar el dataset, salvo corte por `shouldCancel` o `budgetExhausted`.
- **`src/lib/db.ts`** abstrae todo Postgres (driver `postgres.js`, sin ORM). Expone la interfaz `Store` + `__setStore()` para tests; `src/lib/memory-store.ts` la implementa en memoria (tests y `E2E_STUBS=1`). El upsert va por `unnest` en chunks de 500 y **parsea las columnas tipadas** (`hours`, `created_at`, IDs de relaciones, `company`) desde la fila plana — el mapeo de nombres de propiedades vive al tope de `db.ts` y es parte del setup por proyecto, igual que `columns.ts`. ⚠️ Con cast `::jsonb`/`::jsonb[]` postgres.js ya serializa el valor JS: hacer `JSON.stringify` manual produce **doble encoding** (verificado empíricamente 2026-07-09). ⚠️ El cliente se crea con **`prepare: false`**: el transaction pooler de Supabase (pgBouncer, puerto 6543) no soporta prepared statements, que son el default de `postgres.js` — sin esa opción los queries fallan **sólo en producción** (ADR-0007).
- **`src/lib/flatten.ts`** convierte `PageObjectResponse` → fila plana **respetando la whitelist** de `COLUMNS`. Soporta title, rich_text, number, select/status/multi_select, date (con rango `start → end`), checkbox, url/email/phone, people, relation, files, formula, rollup, created_time/last_edited_time, **created_by, last_edited_by, unique_id** (`<prefix>-<number>`). Tipos no listados → string vacío.
- **`src/lib/columns.ts`** es la **whitelist server-side** de propiedades exportables. El cliente nunca puede pedir columnas fuera de aquí. El orden determina el orden de columnas del CSV. **Editar esta lista** es parte normal del setup por proyecto.
- **`src/lib/config.ts`** — `loadConfig()` exige las **10 env vars** (`NOTION_TOKEN`, `NOTION_DATABASE_ID`, `DATE_COLUMN`, `SESSION_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS`, `APP_ORIGIN`) y lanza error listando las faltantes. No hay defaults. **`src/instrumentation.ts` la invoca al boot** (fail-fast: el server no arranca con vars faltantes; el build no la exige — guard por `NEXT_PHASE`). Las vars del Asistente IA (`LLM_*`, ver abajo) son **opcionales** y NO las valida `loadConfig` — sin ellas el chat sólo muestra "sin modelo".
- **`src/lib/cron.ts`** — deriva los schedules **importando `vercel.json`** (única fuente de verdad); la UI calcula la próxima corrida con `cron-parser` desde ahí. Cambiar un cron = editar solo `vercel.json`.

### Asistente IA (chat con tool-calling)

Chat en lenguaje natural que responde consultando **las mismas funciones de reporte** del `Store` vía **tool-calling**, con **modelos intercambiables**. Todo vive en `src/lib/llm/`:

- **`providers.ts`** — un proveedor es `{baseUrl, apiKey, model}` que habla el dialecto **OpenAI-compatible** `/v1/chat/completions`. `availableProviders()` los arma desde env; `resolveProvider(id)` respeta `LLM_DEFAULT_PROVIDER` y cae al primero. Cambiar de modelo = variables de entorno, sin tocar código. Vars (todas opcionales): **Ollama** `LLM_OLLAMA_BASE_URL` (default `http://localhost:11434/v1`) + `LLM_OLLAMA_MODEL`; **MiniMax** `LLM_MINIMAX_BASE_URL` + `LLM_MINIMAX_API_KEY` + `LLM_MINIMAX_MODEL`. La API key va **sólo en `.env.local`** (nunca commiteada).
- **`client.ts`** — `chatComplete` hace el POST (`stream:false`, `temperature:0`) y mapea `tool_calls`. Seams `__setLlmClient`/`__resetLlmClient` para tests (no mocks globales).
- **`tools.ts`** — `TOOL_DEFS` son 6 herramientas (filtros, por persona, por subproyecto, línea de tiempo, matriz, detalle) que envuelven las funciones de reporte de `db.ts`; `buildFilters` reusa `parseReportFilters` de `report-params.ts`.
- **`agent.ts`** — `runChat(provider, messages, now, dbName)` corre el bucle de tool-calling (`MAX_ITERS=5`). El system prompt (español) obliga a **usar herramientas para cualquier dato numérico** y a **no pedir aclaraciones** (los filtros son todos opcionales — llama la herramienta sin ellos). `cleanReply()` **quita los bloques `<think>…</think>`** de modelos con razonamiento (MiniMax M3 los emite en `content`).
- **`request.ts`** — valida el body (`provider` + `messages` con roles user/assistant y contenido no vacío).
- **`src/lib/chat-store.ts`** — persiste los chats en **`localStorage`** (key `asistente-chats-v1`): local-first, sin identidad por usuario (no hay tabla en Postgres). `deriveTitle`, `saveChat`, `deleteChat`.

### Endpoints

- `GET /api/auth/google` — arranca el flujo: state + PKCE en la cookie `oauth-tx`, 302 a Google. `GET /api/auth/google/callback` — valida y crea la sesión; redirige a `/?bienvenida=1` o a `/?error=<state|google|token|unverified|domain|rate>`. Rate-limit 5/15min por IP sobre el callback (tabla `login_attempts`).
- `GET /api/auth/session` — `{authenticated, user?, role?}`; **fuera** del matcher del proxy. El `role` se lee de la tabla en cada request (nunca de la cookie) y es **decorativo**: sólo decide si la UI dibuja la sección Usuarios. Va por `safeRoleFor` de `src/lib/user-role.ts`, que se traga el error y cae a `viewer` — quien autoriza de verdad es `/api/admin/users`. `POST /api/auth/logout` — destruye la sesión.
- `GET|PATCH|DELETE /api/admin/users` — administración de usuarios (protegido por el proxy). `GET` lista `UserRow[]`; `PATCH` recibe `{email, role}`; `DELETE` recibe `?email=`. Exige `admin`: **403 `forbidden`** si no. **409 `self`** al operar sobre uno mismo, **400 `bad_role`** con un rol inventado, **400 `bad_request`** sin email. ⚠️ Su gate **no lleva `try/catch`**: acá un error de base tiene que cerrar la puerta.
- `POST /api/sync?kind=incremental|full` — acepta **cookie de usuario** OR `Authorization: Bearer $CRON_SECRET`. **Espera inline** (no es 202 background — patrón "void runSync()" no es confiable en Vercel serverless porque la función muere al responder). Responde 200 con `{ok:true, done:true, upserted, deleted}` o `{ok:true, done:false, segmentCount}` (full con `SYNC_BUDGET_MS` agotado — el cliente debe volver a llamar para continuar). Devuelve 409 si hay otra sync corriendo (lock). Devuelve **403 `forbidden`** si el rol no alcanza (`full` exige `admin`; el incremental es libre). `DELETE /api/sync` setea flag de cancel, y su permiso depende del sync **en curso**: con un full corriendo exige `admin`.
- `GET /api/sync/status` — estado actual + `perms: {full, cancel}` ya resueltos contra la tabla `users` (protegido por el proxy). Los permisos viajan acá y no en `/api/auth/session` porque `AppShell` es **hijo** de la página y el modal de sync no vería un rol traído por el shell.
- `GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD` — valida fechas ISO, filtra por `DATE_COLUMN`, ordena ascendente por `DATE_COLUMN` en memoria (la ruta usa `getAllRows` y conserva el pipeline previo a la migración) y stream CSV. Devuelve **503 `no_data`** si el cache está vacío (necesita primer sync manual). Devuelve **500 `date_column_not_in_whitelist`** si `DATE_COLUMN` no está en `COLUMNS`.
- `GET /api/reports/{by-person,by-subproject,timeline,matrix,detail,filters}` — agregados SQL sobre `pages` (totales por persona/subproyecto, evolución `month`/`week`, matriz persona×subproyecto, detalle con cursor, opciones de filtro). Protegidos por el proxy. Spec: `docs/reports/202607081002_reportes_v1_spec.md`.
- `POST /api/chat` — body `{provider, db, messages}`; valida el body, resuelve el proveedor, valida `db` contra `DATABASES` y corre `runChat`. Responde `{reply, toolTrace}`. `maxDuration=120`. `GET /api/chat/providers` — lista los proveedores disponibles + default.

### Páginas (UI)

- **La UI usa shadcn/ui** (Tailwind v4 + CSS variables, **dark fijo** tematizado con la paleta iU en `src/app/globals.css` — sin clase `.dark` ni toggle). Las primitivas viven en `src/components/ui/` (generadas por la CLI, se ajustan como código propio). `src/components/ui/tooltip.tsx` es el Tooltip de shadcn **ajustado**: superficie del sistema (`bg-popover` + `border-border-strong` + sombra) en vez del `bg-primary` del default —que sobre este tema compite con los botones de acción que el tooltip explica—, sin flecha (el cuadrado rotado corta el contorno de un tooltip con borde) y `delayDuration` 300ms. Cada `Tooltip` trae su `TooltipProvider`, así que un botón suelto no depende del árbol. Los botones de icono lo usan en vez del `title` del navegador (lento, sin tema); el `aria-label` sigue siendo el nombre accesible y los E2E los siguen encontrando por él. ⚠️ En Playwright, `mouse.move` **sin `steps`** no cierra un tooltip de Radix: el cierre sigue el `pointermove` y un salto de un solo evento no lo dispara. `src/components/app-modal.tsx` (`AppModal`) es un Dialog **no-modal** (`modal={false}`, backdrop propio): el onboarding guiado necesita clickear su popover con un modal abierto y un Dialog modal vuelve inert todo lo de afuera; además previene `onFocusOutside`/`onOpenAutoFocus` y condiciona `onPointerDownOutside` al tour. El shell conserva su máquina de estados anclada/overlay hecha a mano — el Sidebar de shadcn no la soporta.
- `/` — login con Google + **menú principal**: tarjeta del Asistente IA + tarjetas de BDs desde el registro `src/lib/databases.ts` (hoy solo `tiempos`). Cada tarjeta de BD es un link directo a sus reportes.
- `/db/tiempos/reports` — UI de reportes (export y sync viven en **modals** ahí). `/db/tiempos` — **redirect** legacy a `/db/tiempos/reports` (el dashboard viejo se fusionó con reportes).
- `/asistente` — Asistente IA (top-level, hermano del menú): chat estilo Claude (burbujas usuario/IA, markdown con `react-markdown`, historial en `localStorage` con borrado, selectores BD/modelo). `/db/tiempos/chat` — redirect legacy a `/asistente`.
- `/reports` — redirect legacy a `/db/tiempos/reports`.
- **`src/app/components/app-shell.tsx`** — shell de las páginas autenticadas: sidebar de navegación anclable/ocultable (preferencia en `localStorage` key `sidebar-pinned`). Tiene **dos geometrías**: el default es **panel flotante** pegado al canto izquierdo (`top-16 bottom-4 rounded-r-xl` + sombra, `overflow-hidden` para que los bordes del header/footer no crucen las esquinas) y el chrome a ras de borde a borde se aplica **sólo en la variante `lg:`** cuando está anclada. ⚠️ Atarlo a `pinned` a secas era un bug: debajo de `lg` la barra se comporta como overlay aunque `pinned` siga true, así que en ventanas angostas se pegaba a `y=0` y **tapaba la hamburguesa** (medido: gap −52px en 900×600). `top-16` es aritmética, no gusto: 16px del botón + 36px de su alto (`size="icon"`) + 12px de aire. Ese gap fijo es lo que mantiene la hamburguesa clickeable con el panel asomado, y hay dos E2E que lo miden (uno ≥lg y uno a 900×600). La forma depende de `pinned`, **no** de `peek`: si el margen y el radio aparecieran junto con el asomo, la barra cambiaría de forma mientras entra. Desanclada tiene **tres estados**, no dos: oculta, **asomada por hover** (`peek`, estilo Notion — el cursor sobre la hamburguesa la muestra sin backdrop y sin correr el contenido; se va sola al alejarse) y overlay con backdrop (sólo móvil y el paso del tour). El **click en la hamburguesa ancla** en desktop (`matchMedia("(min-width: 1024px)")`) y abre el overlay debajo de ese breakpoint. ⚠️ La transición de la barra lista **`translate`**, no `transform`: en Tailwind v4 las utilidades `-translate-x-*` compilan a la propiedad CSS `translate`, así que un `transition-[transform,…]` se genera sin error pero **no anima** (medido por frame: −256 → 0 sin intermedios). Cubierto por el E2E "la sidebar entra deslizándose, no de golpe". Hay **un solo control para esconderla** (la ✕ de su header, `aria-label="Ocultar menú"`): desancla si estaba anclada y sólo cierra si estaba asomada o en overlay — el par anclaje/cierre de antes obligaba al usuario a distinguir dos estados que sólo existen en el código. Debajo de `lg` no toca la preferencia (ahí anclar no aplica). La navegación y el logout viven ahí; cada página la monta solo en su rama autenticada y pasa `onLogout` para resetear su estado local. El footer de sesión es el disparador de un **`DropdownMenu`** (`aria-label="Menú de sesión"`) con Configuración, Ayuda y Cerrar sesión — el logout dejó de ser un icono suelto, así que los E2E abren el menú antes de cerrar sesión. Va con `modal={false}` por el mismo motivo que `AppModal`, y mientras está abierto el efecto del `peek` no cierra la barra: si no, el cursor cruza `PEEK_HIT_X` camino a un item y la barra desaparece dejando el menú flotando.
- **Onboarding guiado** (`src/lib/tour/` + `src/app/components/tour/`) — spotlight por página: un `<div>` sobre el rect del ancla con `box-shadow: 0 0 0 9999px rgba(5,23,88,.8)` oscurece todo menos el recorte, más un blocker que se come los clicks (las sombras no capturan punteros). Tres guiones declarativos en `scripts.ts` (`menu` 5 pasos → `reports` 7 → `asistente` 4) con encadenado **opt-in** vía `?tour=<id>`. El tour entra a las páginas **por props de `AppShell`** (`tour={{id, actions}}`), no por contexto: `AppShell` es hijo de la página, así que un contexto declarado en el shell no alcanzaría al componente que tiene el `setModal`. Los pasos declaran `before`/`after` (`openSyncModal`/`closeModal`) para explicar los modals por dentro; el `after` corre también al abortar, así un tour cancelado no deja un modal abierto. El "?" flotante arriba a la derecha reinicia el recorrido de la página. La bienvenida se ofrece **una sola vez por navegador** en modal (`localStorage` key `onboarding-v1`) y como tira discreta en los logins siguientes; sólo cuenta la vuelta del callback de Google (`?bienvenida=1`), no un F5 con la cookie viva. ⚠️ Los E2E que inician sesión deben usar `login()` de `tests/e2e/helpers.ts`: sin sembrar `welcomeSeen`, el modal intercepta los clicks.
  - ⚠️ Dos trampas del motor, ambas con test de regresión en `tests/e2e/onboarding.spec.ts`: `runAction` lee las acciones **por ref**, no por closure (la página de reportes hace polling de sync y recrea `tour`/`shellActions` en cada render; con la identidad en las deps, el efecto de entrada al paso se re-disparaba y cerraba y reabría el modal del paso vigente), y la medición busca el ancla durante `ANCHOR_FRAMES` frames en vez de uno (el `before` abre el modal con un setState de la página y React comita ese render **después** de que el efecto ya corrió).
- **`src/app/components/settings/`** — panel de configuración: modal grande centrado con secciones (Cuenta, Usuarios, Acerca de). **No reúsa `AppModal`**: ese es no-modal y está anclado a `top-16` por el onboarding, y acá se quiere lo contrario. La sección **Usuarios sólo existe para admins** (`canManageUsers`) y no se le veda al viewer con tooltip — no se le dibuja. Dentro de la tabla sí hay veto explicado: la **fila propia** lleva el rol y el borrado con `aria-disabled` + tooltip, porque el control existe en todas las demás filas. Borrar confirma **en la propia fila** (un Dialog dentro de otro Dialog trae problemas de foco) y la copy aclara que **borrar no quita el acceso**: la puerta es `ALLOWED_EMAIL_DOMAINS` y `recordLogin` recrea la fila como `viewer`.
- **El backend sigue single-DB**: agregar una entrada a `databases.ts` solo agrega la tarjeta al menú; soportar otra BD real es MB-02 en `docs/to-dos.md` (config/snapshot/sync/APIs por BD).

### Auth

- **`src/proxy.ts`** (convención Next 16, ex-`middleware.ts`; runtime nodejs) protege `/api/export/*`, `/api/sync/status`, `/api/reports/*`, `/api/chat` y `/api/admin/*` con iron-session. **`/api/sync` no está en el matcher** — su auth (cookie OR cron bearer) la maneja la route handler. **`/api/auth/session` tampoco**: tiene que contestar `{authenticated:false}` sin sesión en vez de 401.
- **Login con Google** (ADR-0008), única puerta: no hay password. `src/lib/google-oauth.ts` tiene TODO el flujo (state, PKCE S256, cookie sellada `oauth-tx` de 10 min, canje del code, lectura del ID token, allowlist) **sin importar nada de Next**, y `resolveCallback()` es el orquestador puro — la route handler sólo traduce HTTP, porque `cookies()` lanza fuera de un request y la orquestación se quedaría sin tests. ⚠️ **No se verifica la firma del `id_token`**: llega del canje directo por TLS, el canal autentica el origen. Si algún día llega por otra vía, hay que verificarla. La restricción por dominio es **nuestra**, en `ALLOWED_EMAIL_DOMAINS` (comparación exacta: subdominio no listado NO entra; lista vacía = nadie entra); el claim `hd` de Google es sólo una pista y no se usa. Un solo proyecto de Google Cloud alcanza para varios dominios: el consent screen va **External** y publicado, y el Client ID identifica la app, no el dominio.
- **Única definición de sesión**: `src/lib/session.ts` (opciones + tipo `SessionData {authenticated?, user?}`). `src/lib/auth.ts` sólo la re-exporta. `SESSION_SECRET` no tiene fallback: si falta, el fail-fast de `instrumentation.ts` impide arrancar.
- ⚠️ **`GET /api/auth/stub-login`** emite una sesión sin credenciales para que Playwright pueda entrar. Sólo existe con `E2E_STUBS=1` (404 si no) y con correos fijos —los trae la ruta, no la query—. Acepta `?role=admin|viewer` (default `admin`, valor inválido → 400) y emite **una identidad distinta por rol**: la suite corre `fullyParallel` sobre un memory-store singleton de proceso, así que con un solo correo el login admin de un test le arrebataba el rol al viewer de otro. Cubierto por un test de que da 404 sin la bandera.
- **Roles** (spec `docs/superpowers/specs/2026-08-10-gestion-usuarios-roles-design.md`): `admin` y `viewer`, en la tabla `users`, que **es la única fuente de verdad** — el rol NO se cachea en la sesión, porque la cookie dura 7 días y una degradación tardaría eso en surtir efecto. `src/lib/authz.ts` tiene las reglas puras (`canTrigger`, `canCancel`, `roleOrDefault`, `normalizeEmail`), sin importar nada de Next, por el mismo motivo que `google-oauth.ts`. Lo restringido es el **full sync** y la **administración de usuarios**: el incremental, los reportes, el export y el Asistente son de todos. El rol no reemplaza a `ALLOWED_EMAIL_DOMAINS`, que sigue siendo la puerta de entrada. `canManageUsers(role)` decide la pantalla de administración y `canEditUser(actor, target)` prohíbe operar sobre uno mismo — de ahí sale, sin contar admins ni reglas de «último admin», que **nunca pueda quedar la app sin ningún admin**: quien administra no puede degradarse ni borrarse. `src/lib/user-role.ts` es la lectura **tolerante** del rol (para pintar); los gates leen `getUserRole` directo, sin catch.
- El **cron conserva permisos plenos** (`Authorization: Bearer $CRON_SECRET`): no tiene persona detrás a quien asignarle rol. Una sesión sin `user.email` (cookie previa a ADR-0008) cae a `viewer`.
- ⚠️ **La tabla `users` no es una dependencia de la puerta.** El `recordLogin` del callback y el lookup de rol de `/api/sync/status` van en `try/catch` y siguen: registrar la visita ocurre *después* de que Google verificó la identidad y el dominio pasó el allowlist, así que no es una condición de entrada. Bloqueantes convertían cualquier problema de la base en "nadie entra" — con la tabla sin migrar, el callback daba 500 y el status dejaba el modal de sync en blanco (2026-08-10). El modo degradado va hacia el lado seguro: sin fila, `roleOrDefault` da `viewer`, o sea que un fallo quita permisos, nunca los regala. **El gate de `/api/sync` NO lleva catch a propósito**: ahí un error tiene que cortar el sync, no dejarlo pasar. Regresiones en `tests/integration/callback-registro.test.ts` y `sync-authz.test.ts`.
- ⚠️ En la UI los botones vedados van con **`aria-disabled` y sin `onClick`**, no con `disabled`: un botón deshabilitado no emite eventos de puntero y el tooltip que explica el veto nunca aparecería.

### Crons (Vercel)

`vercel.json` declara **sólo el incremental**: `0 21 * * *` (UTC). Vercel lo llama con `Authorization: Bearer $CRON_SECRET`, y **sólo en deploys de producción** (rama `main`). En Hobby cada expresión permite una corrida diaria.

- **El full NO se cronea** (ADR-0007): un cron dispara UNA invocación y no encadena. Con `SYNC_BUDGET_MS` cada invocación corta y devuelve `done:false` esperando que el cliente vuelva a llamar — cosa que el cron nunca hace. Y el checkpoint (`full:active`/`full:pivot`, TTL 24h) expiraría justo antes de la corrida siguiente, así que cada día empezaría de cero. El full se dispara desde la UI, que **sí** encadena (hasta 20 llamadas).
- **`cronSchedule(kind)` devuelve `null`** cuando ese kind no está en `vercel.json` (ausencia = configuración válida). Se evalúa en el top-level de `/api/sync/status`: si lanzara, esa route daría 500 y rompería el modal de sync. La UI muestra "Full sólo manual".
- **Tras el primer deploy hay que hacer un "Full" manual** antes de que `/api/export` deje de responder 503. Conviene correrlo **desde local** (sin cap de 60s: `SYNC_BUDGET_MS` no va en `.env.local`) en vez de encadenar tramos desde el navegador.
- **El progreso se muestra sin denominador.** `status.total` es `done + page_size` cuando queda más — Notion no expone un total de antemano, así que un "1,200 / 1,300" fingía un avance que nadie conoce.

### Esquema de Postgres (migración `supabase/migrations/`)

| Tabla | Propósito |
|---|---|
| `pages` | Snapshot vivo. `id` (page id) PK, columnas tipadas para reportes (`hours`, `created_at`, `person_id`, `subproject_id`, `project_id`, `company`, `last_edited_at`) + `row` jsonb con la fila plana completa. Índices en `created_at` y las llaves de filtro. |
| `pages_new` | Staging durante el full sync (mismo shape). Se promueve con swap transaccional al completar o cancelar. |
| `sync_state` | KV de control: `key` PK, `value` jsonb, `expires_at` (TTL emulado: fila vencida = ausente). |
| `login_attempts` | Rate-limit del login: `(ip, window_start)` PK + `count`; ventana fija, purga oportunista. |
| `users` | Usuarios y roles. `email` PK (siempre en minúsculas), `role` (`admin`\|`viewer`, default `viewer`, con `check`), `name`, `created_at`, `last_login_at`. Se puebla sola en el primer login. `last_login_at` se pisa: no hay historial. La UI de administración vive en el panel de configuración; `set-role.cjs` sigue siendo la vía para el primer admin de un despliegue nuevo (la pantalla exige ser admin para verse). |

Keys de `sync_state` (mismas semánticas que las viejas keys de Redis):

| Key | Propósito |
|---|---|
| `meta` | `{lastFullAt, lastIncrementalAt, count}`. |
| `status` | `{state, kind, done, total, startedAt, error, skipped, lastResult}`. |
| `lock` | Lock TTL 600s para evitar syncs concurrentes (NX; retomable al vencer). |
| `cancel` | Flag TTL 1h para abortar sync en curso. |
| `full:pivot` | Checkpoint por batch: `created_time` del último page persistido (para reanudar). TTL 24h. |
| `full:active` | Flag de sesión del full (valor = startedAt ISO). Su ausencia define "sesión nueva"; su presencia hace que el siguiente intento **reanude** sin truncar el staging. TTL 24h. |

### Límites de plataforma

- **`maxDuration`: `/api/sync` = 300s (requiere Vercel Pro), `/api/export` = 60s.** El full pagina en batches de 100 con checkpoint por batch; el cap de 10k de Notion se maneja internamente re-consultando con pivote.
- **En Vercel Hobby `maxDuration` está capado a 60s**, así que una invocación del full puede morir a mitad. Desde el fix FX-004 (2026-07-06) eso ya **no pierde avance**: el flag de sesión + el pivote por batch hacen que el siguiente intento reanude. Para cortes limpios en vez de muertes, definir `SYNC_BUDGET_MS` (p. ej. 40000) — cada invocación corta a tiempo y responde `done:false`.
- **El despliegue vigente es Hobby con `SYNC_BUDGET_MS=40000`** (ADR-0007). Aritmética que lo obliga: ~21k filas ÷ batches de 100 = ~212 requests a Notion a 3 req/s ≈ **71s sólo de fetches**, así que el full nunca cabe en 60s. En local `SYNC_BUDGET_MS` no se define y corre completo de una pasada.
- **Región**: las funciones de Vercel deben ir en la región de Supabase (`pdx1` ↔ `aws us-west-2`); el default `iad1` cruza el continente en cada query de reportes.
- **Cold start** puede ser 5-15s en Hobby.
- **Notion API rate limit**: 3 req/s oficial. Throttle local lo respeta. 429 con `retry-after` se respeta.
- **Notion query cap**: 10,000 resultados por query, incluso paginando con cursor. Razón del chunking.

### Defectos del sync D1–D3: corregidos (2026-07-06, rama `fix/incremental-sync`)

Diagnóstico original con evidencia en `docs/reports/202606101520_incident_report_sync_incremental.md`. Los cinco fixes (FX-001…FX-005) están implementados y cubiertos por tests de regresión en `tests/integration/sync.test.ts`:

- **D1 → FX-001**: el incremental hace **doble query** (vivas + papelera con `is_archived: true` vía `request()` crudo) y `deleteRows` purga las borradas del cache. Nota 2026-07-06: la "verificación empírica" del incident report sobre `in_trash: true` resultó incorrecta — ese parámetro no existe en este endpoint (validation_error 400); ver addendum del report.
- **D2 → FX-002**: `lastIncrementalAt` se captura antes del fetch, el full promueve con el startedAt de su sesión, y un incremental cancelado no avanza la ventana.
- **D3 → FX-004**: full reanudable — upsert por batch al `:new`, pivote checkpointeado por batch, flag de sesión `notion:sync:full:active`, presupuesto opcional `SYNC_BUDGET_MS`.
- **R1 → FX-003**: `status.lastResult` (kind, upserted, deleted, skipped, finishedAt) persiste y se muestra en la UI.
- **FX-005**: `tests/fixtures/fakeNotion.ts` ahora es fiel a la API real (filtra papelera sin `in_trash`, aplica `since`, `on_or_before` y sorts) — la infidelidad del fake era lo que ocultaba D1.
- Contexto operativo: la base real ronda **~21k filas** (>10k), por lo que el full siempre cruza al menos un límite de segmento. Verificado con el corte a Postgres (2026-07-13): full real de 21,146 filas en una invocación.
- **FX-006 (2026-07-28)**: los contadores del full eran locales a la invocación, así que en el despliegue Hobby (con `SYNC_BUDGET_MS`) cada tramo encadenado reescribía `done` desde 0 — la UI mostraba el progreso reiniciándose — y el total final reportaba sólo el último tramo. Ahora se siembran desde el status persistido al reanudar y el total es `countRowsNew()`. Regresión cubierta en `tests/integration/sync.test.ts`.

## Convenciones

- Path alias `@/*` → `src/*` (ver `tsconfig.json`).
- Para tests que tocan Notion/Postgres: usar `__setClient(fake)` de `notion.ts` (fake en `tests/fixtures/fakeNotion.ts`) y `__setStore(newMemoryStore())` de `db.ts` (implementación en `src/lib/memory-store.ts`) en vez de mocks globales. Si cambias comportamiento de la API o del SQL real, actualiza el fake/memory-store para que siga siendo fiel (ver D1 arriba: un fake infiel ocultó un bug real). El SQL real de `db.ts` se cubre con `tests/integration/db.pg.test.ts` (gated por `TEST_DATABASE_URL`, que debe apuntar a un **proyecto Supabase dedicado a tests** — ver bloque de Comandos).
- Errores de Notion 400/401/404 → no se reintenta (permanentes); 429 respeta `retry-after`; otros → backoff exponencial 3 intentos.

## Operación

Herramientas en `scripts/` (leen credenciales de `.env.local`):

```bash
node scripts/reset-sync-state.cjs        # destraba un sync trancado: borra keys de control, trunca pages_new y deja status idle. NO toca el snapshot vivo.
node scripts/check-cache-drift.cjs [sinceISO]   # solo lectura: detecta filas del snapshot desactualizadas vs. Notion (default: últimas 24h)
node scripts/set-role.cjs <email> <admin|viewer>   # promueve/degrada; crea la fila si esa persona nunca entró
```

> Tras aplicar la migración de `users`, **nadie es admin**: la tabla arranca vacía y
> todos caen a `viewer`, así que el primer `set-role.cjs` es parte del despliegue.
> El incremental del cron no se ve afectado en ningún momento.