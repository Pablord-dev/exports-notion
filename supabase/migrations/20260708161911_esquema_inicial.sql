-- Esquema inicial de la migración Redis → Postgres (ADR 0006).
-- pages: snapshot vivo. pages_new: staging del full sync (mismo shape).
-- sync_state: KV de control con TTL emulado por expires_at.
-- login_attempts: rate-limit del login (ventana fija).

-- El sync escribe con el service role / conexión directa; no hay acceso anónimo.
-- RLS queda deshabilitado a propósito: la app es el único cliente y va por DATABASE_URL.

create table pages (
  id             text primary key,           -- page id de Notion
  hours          numeric not null default 0, -- "Registro de horas" (no numérico → 0)
  created_at     timestamptz,                -- "Hora de creación" (= DATE_COLUMN)
  person_id      text,                       -- "Hecho por (no tocar)"
  subproject_id  text,                       -- "Subproyecto (no tocar)" — dimensión principal
  project_id     text,                       -- "Proyecto (no tocar)" (mayoría sin proyecto)
  company        text,                       -- "Empresa productiva"
  last_edited_at timestamptz,                -- "Hora de última edición" (drift check)
  row            jsonb not null              -- fila plana completa (whitelist COLUMNS)
);

create index pages_created_at_idx on pages (created_at);
create index pages_person_id_idx on pages (person_id);
create index pages_subproject_id_idx on pages (subproject_id);
create index pages_project_id_idx on pages (project_id);
create index pages_company_idx on pages (company);

-- Staging del full sync. Se promueve con swap transaccional (DROP + RENAME),
-- así que solo necesita existir con el mismo shape; los índices se recrean al promover.
create table pages_new (like pages including all);

create table sync_state (
  key        text primary key,  -- meta | status | lock | cancel | full:pivot | full:active
  value      jsonb not null,
  expires_at timestamptz        -- null = sin TTL; vencida cuenta como ausente
);

create table login_attempts (
  ip           text not null,
  window_start timestamptz not null,
  count        int not null default 1,
  primary key (ip, window_start)
);
