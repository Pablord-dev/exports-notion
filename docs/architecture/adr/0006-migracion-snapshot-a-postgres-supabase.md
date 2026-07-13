# ADR-0006 — El snapshot migra de Upstash Redis a Postgres (Supabase)

- **Estado:** Aceptada (2026-07-08)
- **Fuentes:** spec de reportes v1 `docs/reports/202607081002_reportes_v1_spec.md`; plan de migración SB-01…SB-14 en `docs/to-dos.md` §5; CLAUDE.md §Arquitectura

## Contexto

La plataforma pasa de "exportar CSV" a "consultar reportes" (horas por persona, por subproyecto y evolución temporal, con drill-down y filtros combinables — ver spec). El snapshot vive hoy en un hash de Upstash Redis, que no tiene índices secundarios, filtros ni agregaciones: cada reporte sería un full scan de ~19.6k filas descargado a la función y agregado en memoria, y cada reporte nuevo sería código a medida.

`src/lib/cache.ts` es la única capa que habla con Redis (lección de diseño que ahora paga): `sync.ts`, `notion.ts`, `flatten.ts` y `columns.ts` no conocen el store.

## Decisión

1. **Motor: Postgres, provisto por Supabase.** Desarrollo local con Supabase CLI (`supabase start`, criterio local-first del proyecto); el cloud de Supabase queda para cuando se retome el despliegue (to-dos §6). Conexión por `DATABASE_URL` única (misma var en local y cloud).
2. **Cliente: driver Postgres directo (`postgres`, "postgres.js") — no `supabase-js`, no ORM.** Los GROUP BY de reportes y los upserts masivos del sync son SQL transparente; PostgREST exigiría vistas/RPC para agregar y penaliza los upserts por lotes; un ORM (Drizzle) agrega dos herramientas para un dominio de ~1 tabla grande y ~5 queries de reporte. Los tipos se declaran a mano en la nueva capa `src/lib/db.ts` (misma interfaz que `cache.ts`).
3. **Migraciones SQL versionadas con Supabase CLI** (`supabase/migrations/*.sql`), commiteadas al repo.
4. **Esquema:**

   - **`pages`** — el snapshot vivo. Columnas tipadas para filtrar/agrupar + la fila completa para CSV y detalle:

     | Columna | Tipo | Origen (propiedad Notion) |
     |---|---|---|
     | `id` | `text` PK | page id |
     | `hours` | `numeric NOT NULL DEFAULT 0` | `Registro de horas` (parse; no numérico → 0) |
     | `created_at` | `timestamptz` | `Hora de creación` (= `DATE_COLUMN`) |
     | `person_id` | `text` | `Hecho por (no tocar)` |
     | `subproject_id` | `text` | `Subproyecto (no tocar)` — dimensión principal |
     | `project_id` | `text NULL` | `Proyecto (no tocar)` (la mayoría de registros no lo tienen) |
     | `company` | `text` | `Empresa productiva` |
     | `last_edited_at` | `timestamptz` | `Hora de última edición` (drift check) |
     | `row` | `jsonb` | fila plana completa (whitelist `COLUMNS`) |

     Índices: `created_at`, `person_id`, `subproject_id`, `project_id`, `company`. Las columnas tipadas se pueblan en el upsert desde la fila plana (no columnas generadas: el parse de `hours` y de fechas es lógica de aplicación testeable).

   - **`pages_new`** — staging del full sync (misma estructura). Equivalente del `notion:cache:v1:new`; la promoción replica el RENAME atómico de Redis con una transacción: `TRUNCATE pages` + `INSERT INTO pages SELECT * FROM pages_new` + `TRUNCATE pages_new` (copiar ~20k filas es <1s y evita el DDL de DROP+RENAME, que renombraría índices e invalidaría planes). Misma semántica: el cache vivo nunca se ve a medio construir.

   - **`sync_state`** — KV chico que absorbe las claves de control de Redis (`meta`, `status`, `lock`, `cancel`, `full:pivot`, `full:active`): `key text PK`, `value jsonb`, `expires_at timestamptz NULL`. El TTL de Redis se emula con `expires_at` (una fila vencida cuenta como ausente; el lock se adquiere con `INSERT … ON CONFLICT` condicionado a vencimiento). Mantener la forma KV minimiza el cambio en `sync.ts` y en `scripts/reset-sync-state.cjs`.

   - **`login_attempts`** — reemplazo del rate-limit de Upstash (`ip text`, `window_start timestamptz`, `count int`; ventana fija 5/15min). Detalle en SB-06.

## Consecuencias

- (+) Cada reporte es un `GROUP BY` indexado; un reporte nuevo es una query, no una feature.
- (+) Transacciones reales: la promoción del full y los upserts por batch dejan de depender de la semántica de comandos individuales de Redis.
- (+) Local-first pleno: `supabase start` levanta Postgres local; sin servicio externo para desarrollar (hoy los tests E2E ya evitan Upstash con stubs, pero el dev normal no).
- (+) `db.ts` replica la interfaz de `cache.ts` (incluido `__setClient`), así que `sync.ts`, las routes y los tests de integración cambian mínimamente.
- (−) Docker pasa a ser requisito de desarrollo local (Supabase CLI lo usa).
- (−) Migraciones SQL a mantener y aplicar en cada entorno.
- (−) Doble representación de cada valor (columna tipada + `row` jsonb): el upsert debe poblar ambas de forma consistente — punto único en `db.ts`.
- (−) En serverless, el pool de conexiones Postgres requiere cuidado (pgBouncer/pooler de Supabase); irrelevante en local, se decide al retomar el despliegue (to-dos §6).
- (→) Upstash se retira por completo al final de la migración (SB-11): se van `@upstash/redis`, `@upstash/ratelimit`, `cache.ts` y `memory-redis.ts`.
