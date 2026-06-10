# ExportNotion — Diseño

**Fecha:** 2026-05-17
**Estado:** Draft (pendiente de implementación)

## 1. Propósito

Webapp interna que permite a un grupo cerrado de colaboradores descargar como CSV el contenido de una base de datos de Notion, aplicando un filtro de rango de fechas. Las columnas expuestas están definidas server-side (whitelist); columnas privadas nunca son visibles ni descargables.

La base tiene ~11,000 registros. La API de Notion limita a ~3 req/s, así que el contenido se mantiene en cache (Upstash Redis) y la descarga es instantánea desde cache. El cache se refresca con crons (incremental cada 6 h, full diario) y botones manuales en la UI.

## 2. Stack

- **Next.js 15** (App Router) en **TypeScript**, deployado en **Vercel**.
- **Upstash Redis** (serverless) como cache y coordinación.
- **`@notionhq/client`** (SDK oficial de Notion) para consultar la API.
- **Tailwind CSS** para la UI mínima.
- **`@upstash/ratelimit`** para rate limit del login.
- **`iron-session`** (o equivalente JWT firmado) para cookies de sesión.
- **`bcrypt`** para hashing del password compartido.
- **`cron-parser`** para calcular los próximos disparos de cron desde el `vercel.json`.
- **Vitest** + **MSW** + **Playwright** para tests.

## 3. Arquitectura

```
[Notion API]
     │ (rate-limited 3 req/s, paginación 100/req)
     ▼
[Sync Job] ──► [Upstash Redis]  (cache: pageId -> FlatRow)
  ▲                  │
  │                  ▼
[Cron 6h incremental]  [API /api/export?from=&to=]
[Cron diario full]            │ (filtra en memoria, stream CSV)
[Botón UI manual]             ▼
                       [Descarga CSV al navegador]
```

Tres superficies:
1. **UI pública** (con gate de password): login, form de filtro de fechas, botón descargar, sección de estado con timers de próximos crons.
2. **API routes** (Next.js): `/api/login`, `/api/sync`, `/api/sync/status`, `/api/export`.
3. **Cron jobs** (definidos en `vercel.json`) que invocan `/api/sync` con `CRON_SECRET`.

Justificación de Redis vs disco: Vercel es serverless y no garantiza disco persistente entre invocaciones; Redis además sirve para coordinar locks de sync y estado de progreso compartido entre requests.

## 4. Estructura del código

```
src/
├── app/
│   ├── page.tsx                    # UI: login + form + descarga + estado
│   └── api/
│       ├── login/route.ts          # POST password → set cookie httpOnly
│       ├── sync/route.ts           # POST refresh manual o cron (auth)
│       ├── sync/status/route.ts    # GET progreso + meta + next crons
│       └── export/route.ts         # GET ?from=&to= → stream CSV
├── lib/
│   ├── config.ts                   # Valida env vars al boot, exporta typed config
│   ├── auth.ts                     # verifyPassword(), session cookie helpers
│   ├── notion.ts                   # fetchPages({ since? }, onProgress) → PageObject[]
│   ├── flatten.ts                  # flattenPage(page, whitelist) → Record<string,string>
│   ├── cache.ts                    # getCache(), upsertRows(), deleteRows(), meta helpers
│   ├── sync.ts                     # runSync({ kind }): orquesta notion → flatten → cache
│   ├── filter.ts                   # filterByDateRange(rows, from, to, dateColumn)
│   ├── csv.ts                      # rowsToCSVStream(rows) → ReadableStream
│   ├── columns.ts                  # WHITELIST de columnas a exponer (editada por admin)
│   └── cron.ts                     # nextRun(expression): calcula próximo disparo
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── vercel.json                     # crons + headers
├── .env.example
└── package.json
```

**Principios de partición:**
- `flatten.ts`: función pura, sin red, testeable con fixtures. Concentra los 10+ tipos de propiedades de Notion.
- `notion.ts`: aísla el cliente, paginación y throttling. Cambios de la API solo aquí.
- `cache.ts`: aísla Upstash. Cambiar a otro KV no afecta consumidores.
- `sync.ts`: orquestación reutilizada por cron y botón manual.
- `columns.ts`: única pieza editada regularmente por el admin (whitelist de columnas).

## 5. Modelo en Redis

| Key | Tipo | Contenido | TTL |
|---|---|---|---|
| `notion:cache:v1` | hash | `pageId → JSON(FlatRow)` | sin TTL |
| `notion:meta` | string (JSON) | `{ lastFullAt, lastIncrementalAt, count }` | sin TTL |
| `notion:sync:status` | string (JSON) | `{ state, kind, done, total, startedAt, error?, skipped }` | sin TTL |
| `notion:sync:lock` | string | `"1"` mientras corre un sync | 10 min (auto-libera ante crash) |
| `notion:ratelimit:login:<ip>` | counter | gestionado por `@upstash/ratelimit` | 15 min |

`FlatRow = Record<string, string>` con columnas ya whitelisted y propiedades aplanadas a string (multi_select → `"a, b, c"`; relation → títulos separados por coma; date → ISO; people → nombres separados por coma; etc.).

## 6. Sync (híbrido incremental + full)

**Schedule (`vercel.json`):**
- Incremental cada 6 h: `0 */6 * * *` (00:00, 06:00, 12:00, 18:00 UTC).
- Full diario: `0 9 * * *` (03:00 hora CDMX = 09:00 UTC).

Los horarios no se solapan (el incremental corre en múltiplos de 6 h UTC; el full a 9 UTC), por lo que en operación normal no compiten. Si por algún motivo coincidieran, el segundo recibiría 409 por el lock y se omitiría hasta su próximo turno.

Cada cron es una entrada distinta en `vercel.json` apuntando a la misma ruta con `kind` en query string: `/api/sync?kind=incremental` y `/api/sync?kind=full`. La ruta lee `kind` del query y valida `Authorization: Bearer <CRON_SECRET>`.

**`runSync({ kind: "full" | "incremental" })`:**

1. Adquiere `lock` (`SET notion:sync:lock 1 NX EX 600`). Si falla → 409 "sync ya corriendo".
2. `setSyncStatus({ state: "running", kind, done: 0, total: 0, startedAt: now })`.
3. Si `incremental`:
   - Query a Notion con filtro `last_edited_time > (lastIncrementalAt - 60s)` (overlap de seguridad).
   - Paginar respetando 3 req/s. Para cada batch: aplanar con `flatten.ts` usando whitelist; `HSET notion:cache:v1 <pageId> <jsonRow>`.
   - Para páginas con `archived: true` → `HDEL notion:cache:v1 <pageId>`.
4. Si `full`:
   - Escribir en key temporal `notion:cache:v1:new` durante toda la query.
   - Al finalizar sin error: `RENAME notion:cache:v1:new notion:cache:v1` (atómico).
   - Si falla a mitad, el cache anterior queda intacto.
5. Actualiza `notion:meta` (`lastFullAt` y/o `lastIncrementalAt`, `count = HLEN`).
6. `setSyncStatus({ state: "idle" })`. Libera lock.
7. En error: `setSyncStatus({ state: "error", error })`, libera lock, cache previo intacto.

**Throttling Notion:** wrapper en `lib/notion.ts` que serializa requests a máx 3/s. Respeta `Retry-After` en `429`.

**Reintentos:** 3 reintentos con backoff exponencial (1s, 2s, 4s) para `5xx` transitorios. `401` y `404` fallan inmediato.

**Páginas con shape inesperado:** se omiten, se incrementa `status.skipped`, sync continúa.

## 7. Export

**`GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD`:**

1. Middleware valida cookie de sesión → si no, 401.
2. Validar `from` y `to` (ISO date). Si `from > to` → 400.
3. `HVALS notion:cache:v1` y parsear filas.
4. `filterByDateRange(rows, from, to, DATE_COLUMN)`.
5. `rowsToCSVStream(filtered)` devuelve `ReadableStream`. Response con:
   ```
   Content-Type: text/csv; charset=utf-8
   Content-Disposition: attachment; filename="export-<from>-<to>-<YYYYMMDD-HHmm>.csv"
   ```
6. CSV incluye BOM UTF-8 para que Excel detecte encoding correctamente.

**Casos:**
- Cache vacío (primer deploy, antes del primer sync) → 503 `{ error: "no_data", message: "Aún no hay datos. Corre el primer sync." }`.
- Filtro válido con 0 resultados → 200 con CSV de solo headers (no es error).

**Garantía de privacidad:** el endpoint **ignora cualquier parámetro de columnas** que envíe el cliente. La whitelist en `lib/columns.ts` (server-only) es la única fuente de verdad sobre qué columnas se devuelven.

## 8. UI

Una sola página (`/`) con tres estados:

**Estado 1 — No autenticado:**
- Input de password + botón "Entrar".
- Submit a `POST /api/login`. Si OK, server setea cookie y la página re-renderiza autenticada.
- Error → mensaje "Contraseña incorrecta" (sin distinguir de "rate limited" salvo cuando aplica).

**Estado 2 — Autenticado, idle:**

```
┌─────────────────────────────────────────┐
│  Última sincronización                  │
│    Full:        hoy 03:00 (hace 11h)    │
│    Incremental: hoy 12:00 (hace 2h)     │
│    Registros en cache: 11,042           │
├─────────────────────────────────────────┤
│  Próximas sincronizaciones              │
│    Incremental en 03:47:21  ⏱           │
│    Full         en 14:47:21  ⏱           │
├─────────────────────────────────────────┤
│  [ Refrescar incremental ] [ Full ]     │
├─────────────────────────────────────────┤
│  Descargar CSV                          │
│    Desde:  [ 2026-01-01 ]               │
│    Hasta:  [ 2026-05-17 ]               │
│    [ Descargar ]                        │
└─────────────────────────────────────────┘
```

- Countdowns calculados en cliente desde `next.incremental` y `next.full` (servidos por `/api/sync/status`). Actualizan cada segundo (`setInterval`).
- Cuando un countdown llega a 0, se hace fetch a `/api/sync/status` para refrescar.

**Estado 3 — Sync corriendo:**
- Bloque de timers reemplazado por barra de progreso con `done/total` y etiqueta `kind`.
- Polling a `/api/sync/status` cada 2 s. Al volver a `state: "idle"` recarga `syncedAt` y vuelve al Estado 2.

## 9. Manejo de errores

| Origen | Caso | Manejo |
|---|---|---|
| Notion API | `429` | Respeta `Retry-After`, hasta 3 reintentos por request. |
| Notion API | `5xx` transitorio | Backoff exponencial 1s/2s/4s, hasta 3 reintentos. |
| Notion API | `401` (token inválido) | Sync falla, `status.error = "Token Notion inválido"`, cache previo intacto. |
| Notion API | `404` (base no compartida) | Sync falla con mensaje claro, cache previo intacto. |
| Flatten | Página con shape inesperado | Se omite, `status.skipped++`, sync continúa. |
| Sync | Lock expirado por crash | TTL 10 min libera; el siguiente cron retoma. |
| Sync | Dos crons solapados | El segundo recibe 409 y se omite; siguiente turno corre normal. |
| Sync | Cambio de schema en Notion | Propiedades inexistentes se omiten; nuevas no se exponen hasta agregarlas a `columns.ts`. |
| Export | Sin cookie de sesión | 401, redirige a login. |
| Export | Cache vacío | 503 con mensaje "no_data". |
| Export | `from > to` o fechas inválidas | 400 con mensaje claro. |
| Export | 0 resultados | 200 con CSV de solo headers. |

## 10. Seguridad

- **Password:** se guarda solo el **hash bcrypt** en `APP_PASSWORD_HASH`. `verifyPassword` usa `bcrypt.compare` (constant-time).
- **Sesión:** cookie `httpOnly`, `Secure`, `SameSite=Lax`, firmada con `SESSION_SECRET` (iron-session o JWT). TTL 7 días.
- **Rate limit del login:** 5 intentos por IP cada 15 min vía `@upstash/ratelimit`. Mitiga brute force.
- **Cron auth:** Vercel envía `Authorization: Bearer <CRON_SECRET>` al invocar `/api/sync`. Validar contra env var antes de ejecutar.
- **Whitelist server-only:** `lib/columns.ts` no se importa en componentes client. El endpoint ignora cualquier parámetro de columnas del cliente.
- **Headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. HTTPS por default de Vercel.
- **Logs:** nunca incluyen contenido de filas; solo IDs y tipos de error.

## 11. Variables de entorno

| Variable | Descripción |
|---|---|
| `NOTION_TOKEN` | Integration token de Notion (con acceso a la base). |
| `NOTION_DATABASE_ID` | ID de la base a exportar. |
| `DATE_COLUMN` | Nombre exacto de la propiedad fecha sobre la que se filtra en el export. |
| `APP_PASSWORD_HASH` | Hash bcrypt del password compartido. |
| `SESSION_SECRET` | Secret para firmar cookies de sesión (mínimo 32 bytes). |
| `CRON_SECRET` | Bearer token que valida invocaciones de los crons. |
| `UPSTASH_REDIS_REST_URL` | URL del Redis de Upstash. |
| `UPSTASH_REDIS_REST_TOKEN` | Token del Redis de Upstash. |

Todas en Vercel project settings. Un `.env.example` documenta las claves (sin valores).

## 12. Testing

**Filosofía:** la lógica más densa y propensa a bugs es `flatten.ts` (10+ tipos de propiedad de Notion). Ahí va el grueso de tests unitarios. El resto se cubre con integración delgada (MSW) y un smoke e2e (Playwright).

**Herramientas:** Vitest (unit + integration), MSW (mocks de Notion), Playwright (smoke e2e), `ioredis-mock` o Redis local en Docker para integración con cache.

| Test | Verifica |
|---|---|
| `flatten.test.ts` | Un caso por tipo de propiedad (title, rich_text, number, select, multi_select, date, checkbox, url, email, phone, people, relation, rollup, formula, files, status). Casos null/vacío. Solo emite columnas whitelisted. |
| `filter.test.ts` | Rangos incluyen/excluyen bordes correctamente. `from` o `to` ausentes. Filas con fecha null. ISO mal formado. |
| `csv.test.ts` | Escape de comas, comillas, saltos de línea. BOM UTF-8. Orden estable de headers. |
| `auth.test.ts` | `verifyPassword` correcto/incorrecto. Cookie firmada se valida; cookie alterada se rechaza. |
| `sync-incremental.test.ts` | Con MSW: páginas cambiadas y archivadas se upsert/delete correctamente. Lock impide segundo sync simultáneo. Fallo de Notion no toca cache. |
| `sync-full.test.ts` | Cache temporal + rename atómico. Si falla a mitad, cache viejo intacto. |
| `export.test.ts` | Sin cookie → 401. Cache vacío → 503. Filtro válido → CSV correcto. `from > to` → 400. Parámetros de columnas del cliente son ignorados. |
| `smoke.spec.ts` | Playwright: login → filtro de fechas → descarga; assert filas y headers del CSV bajado. |

**Fuera de scope:**
- Llamadas reales a Notion API (frágiles, requieren token).
- Lógica de display de los countdowns.
- Cron jobs de Vercel (es config).

**CI:** GitHub Actions corre unit + integration en cada push. E2E corre en `main` y previo a releases.

## 13. Decisiones pendientes del usuario antes de implementar

1. **Whitelist de columnas:** entregar la lista exacta de propiedades de Notion que se exponen (nombre tal cual aparece en Notion y, opcionalmente, alias para el CSV).
2. **`DATE_COLUMN`:** nombre exacto de la propiedad fecha que se usa para filtrar en el export.
3. **Password inicial:** definir y generar su hash bcrypt para `APP_PASSWORD_HASH`.

## 14. Fuera de scope (no se implementa en esta versión)

- Múltiples bases de datos (la implementación asume una sola base).
- Formatos distintos a CSV (XLSX, JSON, etc.).
- Filtros distintos a rango de fechas (select, búsqueda de texto, checkbox).
- Preview de filas antes de descargar.
- Auditoría / log de quién descargó qué (no hay usuarios individuales).
- Múltiples passwords o roles.
- Internacionalización (UI solo en español).
