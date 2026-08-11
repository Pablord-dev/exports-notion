-- Lista de bloqueo (2026-08-11). Cuando un admin le quita el acceso a alguien, su
-- fila de `users` se borra —pierde el rol y sale de la lista— y su correo queda
-- acá. Son dos tablas y no una columna `blocked_at` en `users` a propósito:
-- `users` responde "quién tiene acceso y con qué rol", y alguien bloqueado no
-- tiene ninguno de los dos.
--
-- Esta tabla SÍ es una condición de entrada, al revés que `users`: el callback de
-- Google la consulta después del allowlist de dominio y rechaza el login. Y el
-- proxy la consulta en cada request protegido, que es lo que cierra la sesión ya
-- emitida — la cookie está sellada y dura 7 días, así que sin este chequeo
-- seguiría valiendo hasta vencer.
--
-- No lleva TTL: un bloqueo dura hasta que un admin lo levanta.

create table if not exists blocked_users (
  email      text primary key,           -- siempre en minúsculas (normalizeEmail)
  name       text,                       -- copiado de users al bloquear, para poder
                                         -- mostrar a quién se bloqueó sin su fila
  blocked_at timestamptz not null default now(),
  blocked_by text                        -- correo del admin que lo hizo
);
