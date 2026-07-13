# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev              # Next dev server
npm run build            # build de producción
npm run lint             # eslint (next lint)
npm test                 # vitest run (unit + integration; lleva --passWithNoTests: un filtro sin matches pasa en silencio)
npm run test:watch       # vitest watch
npx vitest run tests/unit/flatten.test.ts   # un solo archivo
npx vitest run -t "nombre del test"          # filtrar por nombre
npm run test:e2e         # Playwright smoke — por defecto con stubs en memoria (E2E_STUBS=1), sin Upstash/Notion reales
E2E_REAL=1 npm run test:e2e   # contra el server real del puerto 3000 con .env.local
```

> El E2E stub levanta su propio server (`next build` + `next start`, puerto 3100; `next dev` tiene lock por proyecto en Next 16). Stubs: `src/lib/memory-redis.ts` (Redis + rate-limit en memoria, activados por `E2E_STUBS=1` en `cache.ts` y la route de login) y password fijo `e2e-password` en `verifyPassword`. ⚠️ El password E2E NO va por env var: `next start` (16.2.6) pisa el `process.env` heredado con `.env.local` (verificado empíricamente 2026-07-06, contra lo que dice la doc) — sólo pasan limpias las vars que `.env.local` no define, como `E2E_STUBS`.

## Arquitectura

Webapp Next.js 16 (App Router) que sirve **CSV bajo demanda** desde un **snapshot cacheado en Upstash Redis** de una base de Notion. El export NO consulta Notion en vivo — todo pasa por el cache, y el cache se rellena con crons.

### Flujo de datos

```
Notion ──(cron sync)──► Upstash hash `notion:cache:v1` ──(GET /api/export)──► CSV stream
```

- **`src/lib/sync.ts`** orquesta `runSync(kind)` con un **lock en Redis** (`acquireLock` TTL 600s). Devuelve `SyncResult`: `{ok, done:true, upserted, deleted}` o `{ok, done:false, segmentCount}` (sólo full con presupuesto). Dos modos:
  - `incremental`: **dos queries** a Notion con filtro `last_edited_time > lastIncrementalAt - 60s` (OVERLAP_MS): una de vivas (upsert) y una de papelera con `is_archived: true` (delete). No hay forma de traer ambas en una sola query — ver *notion.ts*. `lastIncrementalAt` se captura **antes** del fetch (las ediciones durante el sync caen en la próxima ventana) y **no avanza si el sync fue cancelado**. Siempre devuelve `done:true`.
  - `full`: construye el snapshot en `notion:cache:v1:new` con **upsert progresivo por batch (≤100) y checkpoint de pivote por batch**. Una "sesión" de full se marca con el flag `notion:sync:full:active` (valor = startedAt): flag ausente = sesión nueva (limpia `:new` y pivote); flag presente = **reanudación** — una función muerta a mitad ya NO pierde el avance. Sin `SYNC_BUDGET_MS` la invocación corre hasta terminar; con presupuesto corta a tiempo con checkpoint y devuelve `done:false` para que el cliente encadene. Promueve `:new` → `notion:cache:v1` con RENAME atómico al completar o cancelar; si Notion devuelve 0 páginas en total, no promueve. Al promover, `lastIncrementalAt = startedAt de la sesión` (no el final): lo editado durante el full entra en la ventana del próximo incremental.
- **`src/lib/notion.ts`** usa `@notionhq/client` **v5** con `dataSources.query` (no `databases.query`). `NOTION_DATABASE_ID` debe ser un **Data Source ID**, no el database ID antiguo — obtenerlo via `GET /v1/databases/<id>` → `data_sources[0].id` (header `Notion-Version: 2025-09-03`). Throttle 3 req/s, retry con backoff y respeto de `retry-after`.
  - **Notion limita CUALQUIER query a 10,000 resultados**, incluso paginando con cursor. Para datasets más grandes, full sync se segmenta por `created_time` DESC con filtro `on_or_before: pivote` recursivo.
  - `fetchPages` (incremental): dos queries. ⚠️ En la versión de API `2025-09-03`, `is_archived` **particiona** (omitido = sólo vivas; `true` = sólo papelera) y `in_trash`/`archived` en el body dan `validation_error` 400 aunque los tipos del SDK los declaren (verificado contra el API real el 2026-07-06). Además el SDK v5.21 **descarta `is_archived` en silencio** (whitelist interna de body params), así que la query de papelera va por `client().request()` crudo.
  - `fetchFullBatches` (full): entrega batch por batch vía `onBatch(pages, lastCreatedTime, hasMore)` — ahí el caller persiste y fija checkpoint — y encadena internamente los segmentos del cap de 10k hasta agotar el dataset, salvo corte por `shouldCancel` o `budgetExhausted`.
- **`src/lib/cache.ts`** abstrae todo Redis. Cliente lazy + `__setClient()` para tests. Estructura: hash de filas, KV de meta, KV de status, KV de lock, KV de cancel, KV de pivote del full. `upsertRows`/`deleteRows` chunkean a 500 fields por request. `getAllRows` usa `HSCAN` paginado.
- **`src/lib/flatten.ts`** convierte `PageObjectResponse` → fila plana **respetando la whitelist** de `COLUMNS`. Soporta title, rich_text, number, select/status/multi_select, date (con rango `start → end`), checkbox, url/email/phone, people, relation, files, formula, rollup, created_time/last_edited_time, **created_by, last_edited_by, unique_id** (`<prefix>-<number>`). Tipos no listados → string vacío.
- **`src/lib/columns.ts`** es la **whitelist server-side** de propiedades exportables. El cliente nunca puede pedir columnas fuera de aquí. El orden determina el orden de columnas del CSV. **Editar esta lista** es parte normal del setup por proyecto.
- **`src/lib/config.ts`** — `loadConfig()` exige las **9 env vars** (`NOTION_TOKEN`, `NOTION_DATABASE_ID`, `DATE_COLUMN`, `APP_PASSWORD_HASH`, `SESSION_SECRET`, `CRON_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `DATABASE_URL` — las `UPSTASH_*` se retiran al completar SB-11/ADR-0006) y lanza error listando las faltantes. No hay defaults. **`src/instrumentation.ts` la invoca al boot** (fail-fast: el server no arranca con vars faltantes; el build no la exige — guard por `NEXT_PHASE`).
- **`src/lib/cron.ts`** — deriva los schedules **importando `vercel.json`** (única fuente de verdad); la UI calcula la próxima corrida con `cron-parser` desde ahí. Cambiar un cron = editar solo `vercel.json`.

### Endpoints

- `POST /api/login` — bcrypt + iron-session, rate-limit 5/15min por IP (Upstash Ratelimit). `DELETE /api/login` destruye la sesión (logout).
- `POST /api/sync?kind=incremental|full` — acepta **cookie de usuario** OR `Authorization: Bearer $CRON_SECRET`. **Espera inline** (no es 202 background — patrón "void runSync()" no es confiable en Vercel serverless porque la función muere al responder). Responde 200 con `{ok:true, done:true, upserted, deleted}` o `{ok:true, done:false, segmentCount}` (full con `SYNC_BUDGET_MS` agotado — el cliente debe volver a llamar para continuar). Devuelve 409 si hay otra sync corriendo (lock). `DELETE /api/sync` setea flag de cancel.
- `GET /api/sync/status` — estado actual (protegido por el proxy).
- `GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD` — valida fechas ISO, filtra por `DATE_COLUMN`, ordena ascendente por `DATE_COLUMN` en memoria (el hash de Redis no preserva orden) y stream CSV. Devuelve **503 `no_data`** si el cache está vacío (necesita primer sync manual). Devuelve **500 `date_column_not_in_whitelist`** si `DATE_COLUMN` no está en `COLUMNS`.

### Auth

- **`src/proxy.ts`** (convención Next 16, ex-`middleware.ts`; runtime nodejs) protege `/api/export/*` y `/api/sync/status` con iron-session. **`/api/sync` no está en el matcher** — su auth (cookie OR cron bearer) la maneja la route handler.
- **Única definición de sesión**: `src/lib/session.ts` (opciones + tipo). `src/lib/auth.ts` sólo la re-exporta y agrega `verifyPassword` (bcrypt) — no pueden divergir. `SESSION_SECRET` no tiene fallback: si falta, el fail-fast de `instrumentation.ts` impide arrancar.

### Crons (Vercel)

`vercel.json`: full `0 9 * * *` y incremental `0 21 * * *` (UTC). En Hobby cada expresión sólo permite una corrida diaria — por eso ambos son diarios. Vercel los llama con `Authorization: Bearer $CRON_SECRET`.

- **El cron full dispara UNA invocación de `runSync("full")`.** Sin `SYNC_BUDGET_MS`, esa invocación encadena internamente los segmentos de 10k y corre hasta terminar — si cabe en `maxDuration`. Si la función muere a mitad, el avance queda checkpointeado (flag de sesión + pivote por batch) y la siguiente invocación (cron del día siguiente o botón Full de la UI) **reanuda donde quedó**. Con `SYNC_BUDGET_MS` definido, cada invocación corta a tiempo y responde `done:false`; la UI encadena las llamadas, el cron no (procesa un tramo por día).
- **Tras el primer deploy hay que hacer un "Full" manual desde la UI** antes de que `/api/export` deje de responder 503.

### Claves de Redis en Upstash

| Key | Tipo | Propósito |
|---|---|---|
| `notion:cache:v1` | hash | Cache vivo. Field=page id, value=JSON de fila plana. |
| `notion:cache:v1:new` | hash | Cache en construcción durante full sync. Se promueve por RENAME al completar. |
| `notion:meta` | string (JSON) | `{lastFullAt, lastIncrementalAt, count}`. |
| `notion:sync:status` | string (JSON) | `{state, kind, done, total, startedAt, error, skipped, lastResult}`. |
| `notion:sync:lock` | string | Lock TTL 600s para evitar syncs concurrentes. |
| `notion:sync:cancel` | string | Flag TTL 1h para abortar sync en curso. |
| `notion:sync:full:pivot` | string | Checkpoint por batch: `created_time` del último page persistido (para reanudar). TTL 24h. |
| `notion:sync:full:active` | string | Flag de sesión del full (valor = startedAt ISO). Su ausencia define "sesión nueva"; su presencia hace que el siguiente intento **reanude** sin borrar el `:new`. TTL 24h. |

### Límites de plataforma

- **`maxDuration`: `/api/sync` = 300s (requiere Vercel Pro), `/api/export` = 60s.** El full pagina en batches de 100 con checkpoint por batch; el cap de 10k de Notion se maneja internamente re-consultando con pivote.
- **En Vercel Hobby `maxDuration` está capado a 60s**, así que una invocación del full puede morir a mitad. Desde el fix FX-004 (2026-07-06) eso ya **no pierde avance**: el flag de sesión + el pivote por batch hacen que el siguiente intento reanude. Para cortes limpios en vez de muertes, definir `SYNC_BUDGET_MS` (p. ej. 40000) — cada invocación corta a tiempo y responde `done:false`.
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
- Contexto operativo: la base real ronda **~19.6k filas** (>10k), por lo que el full siempre cruza al menos un límite de segmento.

## Convenciones

- Path alias `@/*` → `src/*` (ver `tsconfig.json`).
- Para tests que tocan Notion/Redis: usar `__setClient(fake)` exportado en `notion.ts` y `cache.ts` en vez de mocks globales. Los fakes viven en `tests/fixtures/` (`fakeNotion.ts`, `fakeRedis.ts`); si cambias comportamiento de la API real, actualiza el fake para que siga siendo fiel (ver D1 arriba: un fake infiel ocultó un bug real).
- Errores de Notion 400/401/404 → no se reintenta (permanentes); 429 respeta `retry-after`; otros → backoff exponencial 3 intentos.
- **`APP_PASSWORD_HASH` en `.env.local` debe ir con `\$` escapados** (`\$2b\$10\$...`) porque Next/`dotenv-expand` interpreta `$2b`, `$10` como variables. En la UI de Vercel pegar el hash literal sin escape.

## Operación

Herramientas en `scripts/` (leen credenciales de `.env.local`):

```bash
node scripts/reset-sync-state.cjs        # destraba un sync trancado: borra lock/cancel/pivote/:new y deja status idle. NO toca el cache vivo.
node scripts/check-cache-drift.cjs [sinceISO]   # solo lectura: detecta filas del cache desactualizadas vs. Notion (default: últimas 24h)
```

## ⚙️ Modo de trabajo: orchestrator vs. flujo normal

### 0. Configuración (personalizable)

> **PALABRA_CLAVE = `kiubo`**
> Palabra que activa el orchestrator. Cámbiala si quieres otra (`orchestrator`, `pipeline`, etc.).

> **AGENTS_ROOT = `~/kiubo`**
> Ruta **base** donde vive la arquitectura de agentes, **fuera del proyecto actual** para no mezclarla.
> Cámbiala a donde la tengas (ruta absoluta o relativa al home; p. ej. `~/kiubo`, `/opt/kiubo`, `../kiubo`).
> Todas las rutas de abajo cuelgan de aquí:
>
> | Recurso | Ruta |
> |---|---|
> | ROUTER | `${AGENTS_ROOT}/orchestrator/ROUTER.md` |
> | Catálogo | `${AGENTS_ROOT}/catalog.yaml` |
> | Flows | `${AGENTS_ROOT}/flows/` |
> | Agentes compartidos | `${AGENTS_ROOT}/shared/` |
> | Plantillas | `${AGENTS_ROOT}/_templates/` |

**Regla de aislamiento (obligatoria):** la arquitectura de agentes se **lee** desde `AGENTS_ROOT`, nunca desde el proyecto actual. El asistente **NO** debe analizar, indexar, buscar, refactorizar ni crear estos archivos/carpetas dentro del repo donde interviene; si no existen bajo `AGENTS_ROOT`, avisa en vez de asumir que están en el proyecto. Todo el trabajo técnico (análisis, búsqueda, cambios de código) ocurre **solo** en el proyecto actual.

### 1. Regla principal (obligatoria)

**Al inicio de cada prompt que implique una tarea de trabajo** — es decir, cualquier solicitud que **algún flow del catálogo vigente** (`${AGENTS_ROOT}/catalog.yaml`) pueda atender, no una lista fija de dominios. El catálogo es la fuente de verdad del alcance y puede crecer; si los `triggers` de algún flow encajan con la solicitud, cuenta como trabajo:

- Si el usuario **escribe la PALABRA_CLAVE** (`kiubo`) en su mensaje → ir directo por el **orchestrator**, sin preguntar.
- Si **no** la escribe → **preguntar primero**: *"¿Quieres que use `kiubo` (orchestrator) o el flujo normal?"*
  - Responde **orchestrator / `kiubo`** → enrutar con el ROUTER (`${AGENTS_ROOT}/orchestrator/ROUTER.md` + `${AGENTS_ROOT}/catalog.yaml`), emitir el plan JSON y **ejecutar automáticamente el/los flow(s)** siguiendo sus pipelines y quality gates, sin volver a pedir confirmación entre pasos (salvo los checkpoints humanos que el flow exija).
  - Responde **flujo normal** → atender el prompt de forma directa, sin ROUTER ni flows.

**Excepciones (no preguntar):** saludos, preguntas triviales, una sola acción mecánica obvia, o cuando el usuario ya indicó explícitamente en ese mismo prompt qué modo usar.

### 1.1 Reutilización del brief de proyecto (obligatoria)

El **análisis profundo del proyecto** (el "brief": entendimiento global del codebase, mapa de arquitectura, índice) es **caro y compartido por todos los flows**. Se construye **una sola vez** y se reutiliza; **no se re-analiza en cada invocación de un flow**.

El brief se guarda con el **commit/hash de git y la fecha** con que se generó. Antes de ejecutar cualquier flow:

- **No existe brief** → constrúyelo (este es el paso caro) y continúa con el flow.
- **Existe y el código no ha cambiado** desde su commit/fecha → **reúsalo en silencio**, sin preguntar. Corre solo el flow pedido.
- **Existe pero el código cambió** desde su commit/fecha → **pregunta**:
  *"El brief se generó el `<fecha>` (commit `<hash>`) y el código cambió desde entonces. ¿Lo refresco (incremental, solo lo modificado), lo reconstruyo completo, o uso el brief existente tal cual?"*

> Objetivo: el re-análisis profundo y completo del proyecto es una decisión explícita del usuario (o consecuencia de que no exista brief), **nunca el comportamiento por defecto**. El entregable propio de cada flow sí se genera normalmente en cada invocación, porque no sabemos cuándo cambia su alcance.

### 2. Estructura de guardado de archivos

Los artefactos y documentos fechados se guardan con **prefijo de timestamp**:

```
AAAAMMDDHHMM_nombre_descriptivo.md
```

- `AAAA`=año · `MM`=mes · `DD`=día · `HH`=hora (24h) · `MM`=minutos.
- Separador timestamp↔nombre: guion bajo `_`. Nombre en `snake_case`, sin acentos ni espacios.
- Ejemplo: `202605312214_documentacion.md` → 2026-05-31, 22:14.

| Lleva prefijo de timestamp | NO lleva prefijo (nombre estable) |
|---|---|
| Reportes, planes, actas, entregables fechados, instantáneas | `README.md`, `CLAUDE.md`, índices, ADRs numerados |

Estructura actual de la documentación **del proyecto** (no de los agentes):

```
docs/
├── 00-index.md        # índice maestro (1 línea por documento) — mantenerlo al agregar docs
├── architecture/adr/  # ADRs numerados (nombre estable, sin timestamp) — decisiones destiladas de las actas
├── brief/             # brief vigente del proyecto (project_brief + architecture_map + doc_coverage), con fingerprint de commit
├── guides/            # how-to (manual de usuario + screenshots, cambiar columnas)
├── reports/           # reportes fechados (gap reports, incident reports, planes)
└── archive/           # versiones congeladas y actas de sesión con prefijo de timestamp
```

El **brief** que exige la regla 1.1 vive en `docs/brief/` (el `project_brief.md` registra el commit con que se generó); las versiones anteriores se mueven a `docs/archive/`.