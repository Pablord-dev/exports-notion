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

> El E2E stub levanta su propio server (`next build` + `next start`, puerto 3100; `next dev` tiene lock por proyecto en Next 16). Stubs: `src/lib/memory-store.ts` (implementación en memoria de la interfaz `Store` de `db.ts`, activada por `E2E_STUBS=1` — cubre datos y rate-limit del login) y password fijo `e2e-password` en `verifyPassword`. ⚠️ El password E2E NO va por env var: `next start` (16.2.6) pisa el `process.env` heredado con `.env.local` (verificado empíricamente 2026-07-06, contra lo que dice la doc) — sólo pasan limpias las vars que `.env.local` no define, como `E2E_STUBS`.

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
- **`src/lib/config.ts`** — `loadConfig()` exige las **7 env vars** (`NOTION_TOKEN`, `NOTION_DATABASE_ID`, `DATE_COLUMN`, `APP_PASSWORD_HASH`, `SESSION_SECRET`, `CRON_SECRET`, `DATABASE_URL`) y lanza error listando las faltantes. No hay defaults. **`src/instrumentation.ts` la invoca al boot** (fail-fast: el server no arranca con vars faltantes; el build no la exige — guard por `NEXT_PHASE`). Las vars del Asistente IA (`LLM_*`, ver abajo) son **opcionales** y NO las valida `loadConfig` — sin ellas el chat sólo muestra "sin modelo".
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

- `POST /api/login` — bcrypt + iron-session, rate-limit 5/15min por IP (ventana fija en la tabla `login_attempts`). `DELETE /api/login` destruye la sesión (logout).
- `POST /api/sync?kind=incremental|full` — acepta **cookie de usuario** OR `Authorization: Bearer $CRON_SECRET`. **Espera inline** (no es 202 background — patrón "void runSync()" no es confiable en Vercel serverless porque la función muere al responder). Responde 200 con `{ok:true, done:true, upserted, deleted}` o `{ok:true, done:false, segmentCount}` (full con `SYNC_BUDGET_MS` agotado — el cliente debe volver a llamar para continuar). Devuelve 409 si hay otra sync corriendo (lock). `DELETE /api/sync` setea flag de cancel.
- `GET /api/sync/status` — estado actual (protegido por el proxy).
- `GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD` — valida fechas ISO, filtra por `DATE_COLUMN`, ordena ascendente por `DATE_COLUMN` en memoria (la ruta usa `getAllRows` y conserva el pipeline previo a la migración) y stream CSV. Devuelve **503 `no_data`** si el cache está vacío (necesita primer sync manual). Devuelve **500 `date_column_not_in_whitelist`** si `DATE_COLUMN` no está en `COLUMNS`.
- `GET /api/reports/{by-person,by-subproject,timeline,matrix,detail,filters}` — agregados SQL sobre `pages` (totales por persona/subproyecto, evolución `month`/`week`, matriz persona×subproyecto, detalle con cursor, opciones de filtro). Protegidos por el proxy. Spec: `docs/reports/202607081002_reportes_v1_spec.md`.
- `POST /api/chat` — body `{provider, db, messages}`; valida el body, resuelve el proveedor, valida `db` contra `DATABASES` y corre `runChat`. Responde `{reply, toolTrace}`. `maxDuration=120`. `GET /api/chat/providers` — lista los proveedores disponibles + default.

### Páginas (UI)

- `/` — login + **menú principal**: tarjeta del Asistente IA + tarjetas de BDs desde el registro `src/lib/databases.ts` (hoy solo `tiempos`). Cada tarjeta de BD es un link directo a sus reportes.
- `/db/tiempos/reports` — UI de reportes (export y sync viven en **modals** ahí). `/db/tiempos` — **redirect** legacy a `/db/tiempos/reports` (el dashboard viejo se fusionó con reportes).
- `/asistente` — Asistente IA (top-level, hermano del menú): chat estilo Claude (burbujas usuario/IA, markdown con `react-markdown`, historial en `localStorage` con borrado, selectores BD/modelo). `/db/tiempos/chat` — redirect legacy a `/asistente`.
- `/reports` — redirect legacy a `/db/tiempos/reports`.
- **`src/app/components/app-shell.tsx`** — shell de las páginas autenticadas: sidebar de navegación anclable/ocultable (preferencia en `localStorage` key `sidebar-pinned`; overlay con hamburguesa en móvil o desanclada). La navegación y el logout viven ahí; cada página la monta solo en su rama autenticada y pasa `onLogout` para resetear su estado local.
- **El backend sigue single-DB**: agregar una entrada a `databases.ts` solo agrega la tarjeta al menú; soportar otra BD real es MB-02 en `docs/to-dos.md` (config/snapshot/sync/APIs por BD).

### Auth

- **`src/proxy.ts`** (convención Next 16, ex-`middleware.ts`; runtime nodejs) protege `/api/export/*`, `/api/sync/status`, `/api/reports/*` y `/api/chat` con iron-session. **`/api/sync` no está en el matcher** — su auth (cookie OR cron bearer) la maneja la route handler.
- **Única definición de sesión**: `src/lib/session.ts` (opciones + tipo). `src/lib/auth.ts` sólo la re-exporta y agrega `verifyPassword` (bcrypt) — no pueden divergir. `SESSION_SECRET` no tiene fallback: si falta, el fail-fast de `instrumentation.ts` impide arrancar.

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
- **`APP_PASSWORD_HASH` en `.env.local` debe ir con `\$` escapados** (`\$2b\$10\$...`) porque Next/`dotenv-expand` interpreta `$2b`, `$10` como variables. En la UI de Vercel pegar el hash literal sin escape.

## Operación

Herramientas en `scripts/` (leen credenciales de `.env.local`):

```bash
node scripts/reset-sync-state.cjs        # destraba un sync trancado: borra keys de control, trunca pages_new y deja status idle. NO toca el snapshot vivo.
node scripts/check-cache-drift.cjs [sinceISO]   # solo lectura: detecta filas del snapshot desactualizadas vs. Notion (default: últimas 24h)
```