# To-dos — ExportNotion

> Pendientes para mejorar la app, en **orden cronológico de ejecución**. Fuentes: incident report [202606101520](reports/202606101520_incident_report_sync_incremental.md) (FX-xx), update plan [202606101335](reports/202606101335_update_plan.md) (UP-xx), migración a Supabase (SB-xx, decisión 2026-07-08) y pendientes registrados en `CLAUDE.md`/`README.md`. Marcar al completar; cuando una sección entera cierre, moverla al final como histórico.
>
> **Criterio vigente (2026-07-06):** primero que todo funcione a la perfección **en local**; las tareas de despliegue (Vercel u otra plataforma) quedan diferidas hasta entonces — ver sección 5.

## 1. En curso — rama `fix/incremental-sync` (bugs reales del sync)

El orden interno viene del plan de fixes del incident report (tests primero, blocker al centro):

- [x] **FX-005** — Fake de Notion fiel a la API (filtro `since`, `in_trash`, sorts) + tests de regresión que fallen antes del fix. *(2026-07-06: 10 tests de integración, 7 fallaban en rojo antes del fix.)*
- [x] **FX-001** — Que el incremental vea la papelera y `deleteRows` por fin borre (`src/lib/notion.ts`). *(2026-07-06, corregido el mismo día: `in_trash` no existe en el API real — quedó como **doble query** con `is_archived: true` vía `request()` crudo; ver addendum del incident report.)*
- [x] **FX-002** — Capturar `lastIncrementalAt` **antes** del fetch; usar `startedAt` del full al promover; no avanzarlo si el sync se canceló (`src/lib/sync.ts`). *(2026-07-06)*
- [x] **FX-004** 🚨 blocker — Full reanudable: upsert progresivo por batch al `:new`, checkpoint de pivote por batch, flag de sesión `notion:sync:full:active`, presupuesto opcional `SYNC_BUDGET_MS` (`src/lib/notion.ts`, `sync.ts`, `cache.ts`). *(2026-07-06: sin budget una invocación corre hasta terminar; muerte a mitad ya no pierde avance.)*
- [x] **FX-003** — Persistir `status.lastResult` (kind, upserted, deleted, skipped, finishedAt) y mostrarlo en la UI (R1: contador del último sync). *(2026-07-06)*
- [x] Verificación de cierre: `npm test` (37/37 ✅ + typecheck ✅) + `node scripts/check-cache-drift.cjs` contra datos reales. *(2026-07-06: 5 páginas editadas en Notion en 24h, las 5 frescas en cache, 0 desactualizadas, 0 ausentes — el incremental corregido funciona contra producción.)*
- [x] Commitear el fix en la rama `fix/incremental-sync`. *(2026-07-06: commit `2c7f4d9`.)*

## 2. Higiene inmediata (puede ir en paralelo o justo después)

- [x] Commitear la reorganización de docs/scripts (`README.md`, `docs/00-index.md`, `docs/to-dos.md`, `scripts/`) en un commit separado del fix. *(2026-07-06; `CLAUDE.md` viajó con el commit del fix porque documenta el sync corregido.)*
- [x] Borrar `.planorch/plan.md` (duplicado sin trackear del plan ya archivado en `docs/archive/`). *(2026-07-06)*
- [x] **UP-09** — Reparar `npm run lint`: migrado a `eslint .`, hallazgos de `src/` corregidos (catch tipados con `unknown`, setState fuera de efecto) y overrides para tests/`.cjs`. `npm run lint` sale limpio. *(2026-07-06)*
- [x] **UP-04** — Verificado: la sección Tests del README cubre G-06 (`npm test`, `test:e2e`, requisito `UPSTASH_*`); marcado en el update plan. *(2026-07-06)*

## 3. Robustez (todo verificable en local)

- [ ] Corrida local de punta a punta contra datos reales: full completo (encadenando segmentos), incremental con ediciones/borrados en Notion, cancelación, y export CSV con rango de fechas.
- [x] **UP-06** — `loadConfig()` se invoca al boot vía `src/instrumentation.ts` (fail-fast; el build queda exento con guard de `NEXT_PHASE`). Verificado: sin `.env.local` el server no arranca y lista las 8 vars. *(2026-07-06)*
- [x] Consolidar `src/lib/auth.ts` y `src/lib/session.ts` — verificado que ya estaba consolidado (`auth.ts` re-exporta de `session.ts`, única definición); además se eliminó el fallback inseguro de `SESSION_SECRET` (cubierto por el fail-fast). *(2026-07-06)*
- [x] Renombrar `src/middleware.ts` → `src/proxy.ts` (convención Next 16, export `proxy`, runtime nodejs). Verificado: build OK y 401 sin cookie en `/api/export` y `/api/sync/status`. *(2026-07-06)*
- [x] Hacer el E2E corrible en local sin Upstash real: stubs en memoria (`src/lib/memory-redis.ts`) activados por `E2E_STUBS=1`; Playwright levanta server propio (build+start, puerto 3100) y agrega un test de login exitoso. `E2E_REAL=1` conserva el modo contra el server real. 2/2 en verde. *(2026-07-06; hallazgo: `next start` pisa el env heredado con `.env.local` — documentado en CLAUDE.md.)*

## 4. Documentación y DX (baja prioridad)

- [x] **UP-05** — ADRs 0001–0005 extraídos de las actas a `docs/architecture/adr/` (whitelist, Data Source ID, segmentación 10k, espera inline, presupuesto opcional — el 0005 documenta revert + reintroducción vía FX-004). *(2026-07-07)*
- [x] **UP-07** — Guía `docs/guides/cambiar-columnas.md`: agregar/quitar/renombrar columnas y cambiar `DATE_COLUMN`, con la regla clave (columna nueva/renombrada sale vacía hasta un Full). *(2026-07-07)*
- [x] **UP-08** — `CONTRIBUTING.md` mínimo: convención de commits del repo, verificación requerida y reglas (fakes fieles, sin defaults, docs). *(2026-07-07)*

## 5. Migración a Supabase + reportes consultables (decisión 2026-07-08)

> **Por qué:** la plataforma pasa de "exportar CSV" a "consultar reportes", y el hash de Redis no tiene índices, filtros ni agregaciones — cada reporte sería un full scan en memoria. El snapshot migra de Upstash Redis a **Postgres (Supabase)**. La migración es acotada porque `src/lib/cache.ts` es la única capa que habla con Redis; `sync.ts`, `notion.ts`, `flatten.ts` y `columns.ts` quedan casi intactos.

### Fase A — Alcance y diseño (bloquea el resto)

- [x] **SB-01** — Definir los **reportes v1** con el usuario: qué vistas, filtros y agregaciones se necesitan. Esto determina qué propiedades requieren columna tipada en el esquema. *(2026-07-08: spec aprobado en [reports/202607081002_reportes_v1_spec.md](reports/202607081002_reportes_v1_spec.md) — horas por persona, horas por **subproyecto** (dimensión principal; proyecto es secundario/nullable) y evolución temporal mes/semana; drill-down a detalle paginado; filtros por ID; agregación SQL por request.)*
- [x] **SB-02** — **ADR 0006** escrito y aceptado: motor Postgres (Supabase), cliente **driver directo `postgres.js`** (sin `supabase-js` ni ORM), migraciones con Supabase CLI, esquema `pages` (columnas tipadas + `row` jsonb) / `pages_new` (staging + swap transaccional) / `sync_state` (KV con `expires_at`) / `login_attempts`. Ver [architecture/adr/0006](architecture/adr/0006-migracion-snapshot-a-postgres-supabase.md). *(2026-07-08)*
- [x] **SB-03** — Tipado real: resuelto en el ADR 0006 — `flatten.ts` **no cambia** (la fila plana string sigue siendo el formato del CSV y del `row` jsonb); el parse a tipos (`hours` numeric, `created_at`/`last_edited_at` timestamptz, IDs) vive en el upsert de la nueva capa `db.ts`, punto único y testeable. Verificado contra fila real del cache: `Registro de horas` es string numérico y las fechas de `created_time` son ISO planas (sin rango `→`). *(2026-07-08)*

### Fase B — Infraestructura y capa de datos

- [x] **SB-04** — Entorno local listo: `supabase init` + migración inicial [supabase/migrations/20260708161911_esquema_inicial.sql](../supabase/migrations/20260708161911_esquema_inicial.sql) (tablas `pages`/`pages_new`/`sync_state`/`login_attempts` + índices) + stack corriendo (`supabase start`, DB en `127.0.0.1:54322`). `DATABASE_URL` agregada como **9ª env var obligatoria** (las `UPSTASH_*` se quedan hasta SB-11); docs y test de config actualizados. Nota operativa: el primer `supabase start` se colgó porque el daemon de Docker Desktop dejó de responder — se resolvió reiniciando Docker Desktop (`wsl --shutdown` incluido). *(2026-07-08/09)*
- [x] **SB-05** — [src/lib/db.ts](../src/lib/db.ts): misma interfaz que `cache.ts` sobre postgres.js (upsert masivo vía `unnest` con parse de columnas tipadas, promote = swap transaccional TRUNCATE+INSERT, KV `sync_state` con TTL por `expires_at`, lock NX retomable al vencer, `__setStore` para tests). Verificada contra Postgres real: 8/8 en [tests/integration/db.pg.test.ts](../tests/integration/db.pg.test.ts) (gated `PG_TEST=1`). Hallazgo clave: con cast `::jsonb`/`::jsonb[]` postgres.js ya serializa — hacer `JSON.stringify` manual produce doble encoding (documentado en el código). `sync.ts` y las 3 routes ya importan de `db.ts`. *(2026-07-09)*
- [x] **SB-06** — Rate-limit del login sobre Postgres: `rateLimitLogin(ip)` en la interfaz `Store` (ventana **fija** 5/15min vía `login_attempts` con `date_bin` + purga oportunista en CTE; antes era sliding window de Upstash — cambio documentado). La route de login ya no importa `@upstash/ratelimit` ni `memory-redis`. Cubierto en el test PG (6º intento bloqueado, IPs independientes, ventana nueva resetea) y E2E 2/2. *(2026-07-09)*
- [x] **SB-07** — [src/lib/memory-store.ts](../src/lib/memory-store.ts): implementación en memoria de la interfaz `Store` (fiel al pgStore: TTL vencido = ausente, promote = reemplazo + vaciado, lock NX retomable). `tests/integration/sync.test.ts` migrado a `__setStore(newMemoryStore())` — 37/37 en verde sin cambios de comportamiento. `fakeRedis.ts` y `cache.ts` quedan vivos sólo para la prueba de paridad (SB-10); se retiran en SB-11. *(2026-07-09)*
- [x] **SB-08** — E2E: con `E2E_STUBS=1`, `db.ts` usa `memory-store.ts` (mismo patrón de singleton en `globalThis` que memory-redis). Playwright 2/2 en verde sin servicios reales. `memory-redis.ts` sólo queda vivo para el rate-limit del login (se retira con SB-06/SB-11). *(2026-07-09)*
- [x] **SB-09** — Scripts operativos portados a Postgres: `reset-sync-state.cjs` (borra keys de control en `sync_state`, trunca `pages_new`, status idle — probado contra el Postgres local) y `check-cache-drift.cjs` (compara Notion vs `pages.row`; validación con datos reales pendiente para SB-10). *(2026-07-09)*

### Fase C — Corte

- [x] **SB-10** — Corte ejecutado con datos reales *(2026-07-13)*:
  - Full real: **21,146 filas** upserteadas y promovidas (la base creció desde las ~19.6k documentadas), cruzando el cap de 10k con pivote sin incidencias, en una sola invocación inline.
  - Paridad Redis↔Postgres: **795/795 filas comparables idénticas** byte a byte; 5 diferían sólo porque el subproyecto relacionado fue renombrado en Notion post-snapshot (renombrar una relación no toca `last_edited_time`) — Postgres tiene la versión más fresca.
  - ⚠️ Hallazgo: el cache vivo de Upstash sólo tenía **800 filas** (degradado desde antes de la migración) — los exports recientes desde Redis estaban incompletos; el snapshot completo vive ahora en Postgres.
  - Incremental real: doble query OK, 9 páginas nuevas upserteadas; `check-cache-drift` (ya sobre Postgres): 18/18 frescas, 0 desactualizadas, 0 ausentes.
- [x] **SB-11** — Upstash retirado por completo: eliminados `cache.ts`, `memory-redis.ts`, `fakeRedis.ts` y las deps `@upstash/*`; `config.ts` vuelve a 8 env vars (`DATABASE_URL` reemplaza a las dos `UPSTASH_*`); `CLAUDE.md` reescrito (flujo, `db.ts`, esquema de tablas + keys de `sync_state`, convenciones de fakes) y `README.md`/`CONTRIBUTING.md`/`.env.example` actualizados. Verificación: typecheck, lint, 46/46 (incl. PG), E2E 2/2. Las líneas `UPSTASH_*` de tu `.env.local` ya no se usan (borrarlas cuando quieras). *(2026-07-13)*

### Fase D — Reportes (el objetivo de todo esto)

- [x] **SB-12** — Endpoints `GET /api/reports/*` implementados y verificados en vivo contra las 21k filas *(2026-07-13)*:
  - 5 routes (`by-person`, `by-subproject`, `timeline`, `detail`, `filters`) protegidas por el proxy (401 verificado), validación estricta de params (`report-params.ts`), agregación SQL al momento (~70ms sobre 21k filas), detail con paginación keyset `(created_at, id)`.
  - **Cambio vs spec (addendum en el spec):** se agrupa/filtra por **nombre normalizado**, no por IDs de relación — los IDs faltan en 18-29% de filas con nombre presente y partirían los grupos.
  - Interfaz `Store` + tipos compartidos movidos a `store-shared.ts` (evita ciclo db↔memory-store). Casos de test **compartidos** (`tests/fixtures/reportCases.ts`) corren idénticos contra Postgres real y memory-store → fidelidad por construcción. 53/53 en verde.
  - ⚠️ Incidente resuelto: la primera versión de `db.pg.test.ts` truncaba la base del app y borró el snapshot (se restauró con un full de 21,155 filas). Ahora los tests PG corren contra la base dedicada **`exportnotion_test`**, recreada desde las migraciones en cada corrida.
- [x] **SB-13** — UI de reportes en `/reports` (link desde el dashboard), brandbook iU dark *(2026-07-13)*:
  - Filtros en una fila: rango de fechas + 4 multiselects con búsqueda (persona/subproyecto/proyecto/empresa); tiles de totales; gráfica SVG propia de evolución (semana/mes, tooltip al hover, serie en sky `#02B5D3` — validado contraste sobre surface; blue queda para acciones); tablas por persona y por subproyecto con drill-down; modal de detalle con "Cargar más" (cursor keyset).
  - Verificado visualmente con screenshots (desktop + móvil) contra los datos reales; fixes aplicados: fechas formateadas en UTC (evita el corrimiento de un día en CDMX), códigos largos de subproyecto con `overflow-wrap:anywhere`, error no-401 del catálogo no rompe la página.
  - La fila "(sin subproyecto)" no tiene drill-down (no hay valor por el cual filtrar el detalle) — limitación conocida de v1.
- [x] **SB-14** — Tests + manual *(2026-07-13)*: E2E nuevo (login → `/reports` → filtros y estados vacíos visibles, 3/3 en verde) sumado a los casos compartidos PG/memoria de SB-12 y al unit del parser de params; manual de usuario con sección **"6. Consultar reportes"** (filtros, gráfica, drill-down) + 2 screenshots reales y la fila de rate-limit actualizada a Postgres.

## 6. ⏸️ Diferido — despliegue (retomar cuando lo local esté perfecto)

> La plataforma sigue abierta (Vercel u otra); no invertir aquí todavía. Supabase no condiciona esta decisión: funciona igual desde cualquier plataforma.

- [ ] Decidir plataforma de despliegue. Si es Vercel: Hobby vs Pro (`maxDuration` 60s vs 300s).
- [ ] Si Vercel Hobby: activar `SYNC_BUDGET_MS` (queda listo con FX-004) y evaluar un segundo cron que encadene los segmentos del full (hoy con >10k filas requiere pulsar Full en la UI).
- [ ] Revisar los crons de `vercel.json` (horarios y encadenamiento) según la plataforma elegida.
