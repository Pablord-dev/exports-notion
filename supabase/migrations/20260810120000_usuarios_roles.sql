-- Usuarios y roles (spec 2026-08-10). La tabla se puebla sola en el primer login
-- exitoso, después del chequeo de dominio: no es una lista de invitados, es el
-- registro de quién entró.
--
-- El rol NO reemplaza a ALLOWED_EMAIL_DOMAINS, que sigue siendo la puerta de
-- entrada. Esta capa sólo distingue qué puede hacer alguien que YA entró.

create table if not exists users (
  email         text primary key,           -- siempre en minúsculas (normalizeEmail)
  role          text not null default 'viewer'
                check (role in ('admin','viewer')),  -- un typo en el script falla acá,
                                                     -- en vez de crear un rol fantasma
  name          text,                       -- del ID token de Google; para leer la auditoría
  created_at    timestamptz not null default now(),
  last_login_at timestamptz                 -- se pisa en cada login: no hay historial
);
