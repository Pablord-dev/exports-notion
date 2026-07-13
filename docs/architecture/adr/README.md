# ADRs — decisiones de arquitectura

> Registro de decisiones (Architecture Decision Records) extraídas de las actas de sesión archivadas (`docs/archive/`), donde vive la evidencia completa. Formato: contexto → decisión → consecuencias. Un ADR no se edita para cambiar la decisión: se escribe uno nuevo que lo reemplaza y se cruza la referencia.

| # | Título | Estado | Fecha decisión |
|---|---|---|---|
| [0001](0001-whitelist-server-side-de-columnas.md) | Whitelist server-side de columnas exportables | Aceptada | 2026-05-17 |
| [0002](0002-notion-data-source-id.md) | `NOTION_DATABASE_ID` contiene un Data Source ID (SDK v5) | Aceptada | 2026-05-18 |
| [0003](0003-segmentacion-por-cap-de-10k.md) | Segmentación del full sync por el cap de 10k de Notion | Aceptada | 2026-05-18 |
| [0004](0004-espera-inline-en-api-sync.md) | `POST /api/sync` espera inline (sin "void background") | Aceptada | 2026-06-05 |
| [0005](0005-presupuesto-de-tiempo-opcional.md) | Presupuesto de tiempo del full: de obligatorio a opcional (`SYNC_BUDGET_MS`) | Aceptada | 2026-06-05 · matizada 2026-07-06 |
| [0006](0006-migracion-snapshot-a-postgres-supabase.md) | El snapshot migra de Upstash Redis a Postgres (Supabase) — driver `postgres.js`, esquema `pages`/`pages_new`/`sync_state` | Aceptada | 2026-07-08 |
