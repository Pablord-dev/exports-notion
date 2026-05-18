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
  - `full`: **chunkado por segmentos** para sobrevivir el `maxDuration=60s` de Vercel Hobby. Cada llamada procesa UN segmento (presupuesto 25s) y devuelve `done:false` con pivote guardado, o `done:true` cuando completa. El cliente encadena llamadas hasta que `done:true`. Promueve `notion:cache:v1:new` → `notion:cache:v1` con RENAME atómico **sólo al cerrar la sesión** (todos los segmentos completos o cancelación). Si Notion devuelve 0 páginas en total, no promueve.
- **`src/lib/notion.ts`** usa `@notionhq/client` **v5** con `dataSources.query` (no `databases.query`). `NOTION_DATABASE_ID` debe ser un **Data Source ID**, no el database ID antiguo — obtenerlo via `GET /v1/databases/<id>` → `data_sources[0].id` (header `Notion-Version: 2025-09-03`). Throttle 3 req/s, retry con backoff y respeto de `retry-after`.
  - **Notion limita CUALQUIER query a 10,000 resultados**, incluso paginando con cursor. Para datasets más grandes, full sync se segmenta por `created_time` DESC con filtro `on_or_before: pivote` recursivo.
  - `fetchOneFullSegment` ejecuta un segmento con presupuesto de tiempo (`timeBudgetMs`, default 25s). Devuelve `nextPivot=null` SOLO si Notion confirma `has_more=false` Y el conteo no llegó al cap de 10k Y no se canceló. En cualquier otro caso devuelve el `created_time` del último page para reanudar.
- **`src/lib/cache.ts`** abstrae todo Redis. Cliente lazy + `__setClient()` para tests. Estructura: hash de filas, KV de meta, KV de status, KV de lock, KV de cancel, KV de pivote del full, KV de session del full. `upsertRows`/`deleteRows` chunkean a 500 fields por request. `getAllRows` usa `HSCAN` paginado.
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

- **El cron full sólo dispara UN segmento del chunked full.** Para datasets >10k el cron NO completa el full por sí solo (no encadena). El usuario debe entrar a la UI y pulsar Full para que el cliente encadene los segmentos restantes. Alternativa: agregar un segundo cron a las 09:05 UTC para disparar el siguiente segmento, o upgradear a Pro.
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
| `notion:sync:full:session` | string | "1" mientras hay un full multi-segmento en curso. Evita que el siguiente segmento borre el `new`. TTL 24h. |

### Límites de plataforma

- **Vercel Hobby caps `maxDuration` a 60s.** El código declara `maxDuration=60` para `/api/sync` y `/api/export`. El chunked full está diseñado en torno a esto: cada segmento tiene `timeBudgetMs=25_000` para dejar margen al cold start, upsert final y limpieza.
- **Cold start** puede ser 5-15s en Hobby. Después de eso quedan ~45s para trabajar; el presupuesto de 25s deja margen.
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
  await r.del('notion:sync:lock','notion:sync:cancel','notion:sync:full:pivot','notion:sync:full:session','notion:cache:v1:new');
  await r.set('notion:sync:status', {state:'idle',kind:null,done:0,total:0,startedAt:null,error:null,skipped:0});
  console.log('reset OK');
})();
"
```

`notion:cache:v1` (cache vivo) no se toca.
