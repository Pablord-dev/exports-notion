# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev              # Next dev server
npm run build            # build de producción
npm run lint             # eslint (next lint)
npm test                 # vitest run (unit + integration)
npm run test:watch       # vitest watch
npx vitest run tests/unit/flatten.test.ts   # un solo archivo
npx vitest run -t "nombre del test"          # filtrar por nombre
npm run test:e2e         # Playwright smoke (requiere Upstash real o stubs)
```

> El E2E falla en local sin `UPSTASH_*` reales: `Redis.fromEnv()`/`new Redis({url,token})` revienta en la primera request y tira el handler.

## Arquitectura

Webapp Next.js 16 (App Router) que sirve **CSV bajo demanda** desde un **snapshot cacheado en Upstash Redis** de una base de Notion. El export NO consulta Notion en vivo — todo pasa por el cache, y el cache se rellena con crons.

### Flujo de datos

```
Notion ──(cron sync)──► Upstash hash `notion:cache:v1` ──(GET /api/export)──► CSV stream
```

- **`src/lib/sync.ts`** orquesta `runSync(kind)` con un **lock en Redis** (`acquireLock` TTL 600s). Devuelve `SyncResult` con flag `done` (bool). Dos modos:
  - `incremental`: query a Notion con filtro `last_edited_time > lastIncrementalAt - 60s` (OVERLAP_MS), upsert + delete de archivadas. Un solo segmento, siempre devuelve `done:true`.
  - `full`: **segmentado por el cap de 10k de Notion** (no por tiempo). Cada llamada procesa UN segmento de hasta 10k registros y devuelve `done:false` con pivote guardado, o `done:true` cuando completa. El cliente encadena llamadas hasta que `done:true`. Promueve `notion:cache:v1:new` → `notion:cache:v1` con RENAME atómico al cerrar (último segmento completo o cancelación). Si Notion devuelve 0 páginas en total, no promueve. El "primer segmento" se detecta por **ausencia de pivote** (no hay session flag): ⚠️ si un segmento muere antes de fijar el pivote, el siguiente intento reinicia y borra el `new` acumulado — ver *Límites de plataforma*.
- **`src/lib/notion.ts`** usa `@notionhq/client` **v5** con `dataSources.query` (no `databases.query`). `NOTION_DATABASE_ID` debe ser un **Data Source ID**, no el database ID antiguo — obtenerlo via `GET /v1/databases/<id>` → `data_sources[0].id` (header `Notion-Version: 2025-09-03`). Throttle 3 req/s, retry con backoff y respeto de `retry-after`.
  - **Notion limita CUALQUIER query a 10,000 resultados**, incluso paginando con cursor. Para datasets más grandes, full sync se segmenta por `created_time` DESC con filtro `on_or_before: pivote` recursivo.
  - `fetchOneFullSegment` ejecuta un segmento paginando con cursor hasta agotar resultados (`has_more=false`) o alcanzar el cap de 10k. Devuelve `nextPivot = created_time del último page` SÓLO si rozó el cap de 10k (= hay más records antiguos) y no se canceló; en cualquier otro caso `null` (terminó, no hay más).
- **`src/lib/cache.ts`** abstrae todo Redis. Cliente lazy + `__setClient()` para tests. Estructura: hash de filas, KV de meta, KV de status, KV de lock, KV de cancel, KV de pivote del full. `upsertRows`/`deleteRows` chunkean a 500 fields por request. `getAllRows` usa `HSCAN` paginado.
- **`src/lib/flatten.ts`** convierte `PageObjectResponse` → fila plana **respetando la whitelist** de `COLUMNS`. Soporta title, rich_text, number, select/status/multi_select, date (con rango `start → end`), checkbox, url/email/phone, people, relation, files, formula, rollup, created_time/last_edited_time, **created_by, last_edited_by, unique_id** (`<prefix>-<number>`). Tipos no listados → string vacío.
- **`src/lib/columns.ts`** es la **whitelist server-side** de propiedades exportables. El cliente nunca puede pedir columnas fuera de aquí. El orden determina el orden de columnas del CSV. **Editar esta lista** es parte normal del setup por proyecto.

### Endpoints

- `POST /api/login` — bcrypt + iron-session, rate-limit 5/15min por IP (Upstash Ratelimit). `DELETE /api/login` destruye la sesión (logout).
- `POST /api/sync?kind=incremental|full` — acepta **cookie de usuario** OR `Authorization: Bearer $CRON_SECRET`. **Espera inline** (no es 202 background — patrón "void runSync()" no es confiable en Vercel serverless porque la función muere al responder). Responde 200 con `{ok:true, done:bool}`. Si `done:false`, el cliente debe volver a llamar para procesar el siguiente segmento del full. Devuelve 409 si hay otra sync corriendo (lock). `DELETE /api/sync` setea flag de cancel.
- `GET /api/sync/status` — estado actual (protegido por middleware).
- `GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD` — valida fechas ISO, filtra por `DATE_COLUMN`, ordena ascendente por `DATE_COLUMN` en memoria (el hash de Redis no preserva orden) y stream CSV. Devuelve **503 `no_data`** si el cache está vacío (necesita primer sync manual). Devuelve **500 `date_column_not_in_whitelist`** si `DATE_COLUMN` no está en `COLUMNS`.

### Auth

- **`src/middleware.ts`** protege `/api/export/*` y `/api/sync/status` con iron-session. **`/api/sync` no está en el matcher** — su auth (cookie OR cron bearer) la maneja la route handler.
- Hay **dos archivos de sesión**: `src/lib/auth.ts` y `src/lib/session.ts`. El middleware importa de `session.ts`, las routes de `auth.ts`. Si tocas opciones de sesión, revisa que ambos coincidan o consolida.
- Next 16 sugiere renombrar `middleware.ts` → `proxy.ts`; pendiente.

### Crons (Vercel)

`vercel.json`: full `0 9 * * *` y incremental `0 21 * * *` (UTC). En Hobby cada expresión sólo permite una corrida diaria — por eso ambos son diarios. Vercel los llama con `Authorization: Bearer $CRON_SECRET`.

- **El cron full dispara UN segmento (hasta 10k registros).** Para datasets ≤10k que quepan en `maxDuration`, el cron completa el full en una sola corrida. Para datasets >10k el cron NO completa por sí solo (no encadena): el usuario debe entrar a la UI y pulsar Full para que el cliente encadene los segmentos restantes. Alternativa: un segundo cron que dispare el siguiente segmento.
- **Tras el primer deploy hay que hacer un "Full" manual desde la UI** antes de que `/api/export` deje de responder 503.

### Claves de Redis en Upstash

| Key | Tipo | Propósito |
|---|---|---|
| `notion:cache:v1` | hash | Cache vivo. Field=page id, value=JSON de fila plana. |
| `notion:cache:v1:new` | hash | Cache en construcción durante full sync. Se promueve por RENAME al completar. |
| `notion:meta` | string (JSON) | `{lastFullAt, lastIncrementalAt, count}`. |
| `notion:sync:status` | string (JSON) | `{state, kind, done, total, startedAt, error, skipped}`. |
| `notion:sync:lock` | string | Lock TTL 600s para evitar syncs concurrentes. |
| `notion:sync:cancel` | string | Flag TTL 1h para abortar sync en curso. |
| `notion:sync:full:pivot` | string | `created_time` del último page del segmento previo (para reanudar). TTL 24h. |

### Límites de plataforma

- **`maxDuration`: `/api/sync` = 300s (requiere Vercel Pro), `/api/export` = 60s.** El full segmenta por el **cap de 10k de Notion, no por tiempo**: cada segmento pagina hasta 10k registros de una sola pasada.
- ⚠️ **En Vercel Hobby `maxDuration` está capado a 60s**, así que un segmento de 10k puede no caber y la función morir a mitad. Peor: como **no hay session flag**, si la función muere ANTES de fijar el pivote, el siguiente intento reinicia como "primer segmento" y **borra el `new` acumulado**. Para correr en Hobby de forma confiable habría que reintroducir un presupuesto de tiempo por segmento (esto fue removido a propósito en esta sesión — ver el doc de session changes con prefijo de fecha en `docs/session-changes/`).
- **Cold start** puede ser 5-15s en Hobby.
- **Notion API rate limit**: 3 req/s oficial. Throttle local lo respeta. 429 con `retry-after` se respeta.
- **Notion query cap**: 10,000 resultados por query, incluso paginando con cursor. Razón del chunking.

## Convenciones

- Path alias `@/*` → `src/*` (ver `tsconfig.json`).
- Para tests que tocan Notion/Redis: usar `__setClient(fake)` exportado en `notion.ts` y `cache.ts` en vez de mocks globales.
- Errores de Notion 401/404 → no se reintenta; 429 respeta `retry-after`; otros → backoff exponencial 3 intentos.
- **`APP_PASSWORD_HASH` en `.env.local` debe ir con `\$` escapados** (`\$2b\$10\$...`) porque Next/`dotenv-expand` interpreta `$2b`, `$10` como variables. En la UI de Vercel pegar el hash literal sin escape.

## Operación

Para destrabar un sync trancado (reinicio de dev o función matada en producción):

```bash
node -e "
const fs = require('fs');
const env = fs.readFileSync('.env.local','utf8').split(/\r?\n/);
for (const line of env) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^['\"]|['\"]$/g,''); }
const {Redis} = require('@upstash/redis');
const r = Redis.fromEnv();
(async () => {
  await r.del('notion:sync:lock','notion:sync:cancel','notion:sync:full:pivot','notion:cache:v1:new');
  await r.set('notion:sync:status', {state:'idle',kind:null,done:0,total:0,startedAt:null,error:null,skipped:0});
  console.log('reset OK');
})();
"
```

`notion:cache:v1` (cache vivo) no se toca.

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

Ubicación recomendada de la documentación **del proyecto actual** (no de los agentes):

```
docs/
├── 00-index.md        # índice maestro (1 línea por documento)
├── overview/          # propósito, glosario
├── architecture/      # diseño + adr/ (decisiones)
├── guides/            # how-to (setup, deploy)
├── reference/         # API, esquemas, env vars
└── archive/           # versiones congeladas con prefijo de timestamp
```