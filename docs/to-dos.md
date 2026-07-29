# To-dos — ExportNotion

## 1. Multi-BD (menú listo 2026-07-16; backend pendiente)

> El menú principal (`/` → tarjetas desde `src/lib/databases.ts`) y las rutas por BD (`/db/tiempos`, `/db/tiempos/reports`) ya existen; el backend sigue single-DB.

- [ ] **MB-02** — Soporte multi-BD real en el backend (cuando haya una segunda BD que integrar): config por BD (token / data source id / columnas / whitelist), snapshot por BD (columna `db_id` o tabla por BD), sync y crons por BD, APIs parametrizadas por slug.

## 2. ✅ Despliegue — hecho (2026-07-28)

> Desplegado en **Vercel Hobby + Supabase Cloud**, cloud-only (misma base en local y prod).
> Decisiones y consecuencias en [ADR-0007](architecture/adr/0007-despliegue-vercel-hobby-y-supabase-cloud-only.md); procedimiento en [guides/deploy.md](guides/deploy.md).

- [x] Plataforma decidida: Vercel **Hobby** (cap 60s) + Supabase Cloud por transaction pooler.
- [x] `SYNC_BUDGET_MS=40000` activo en Vercel; sin definir en local (el full corre completo).
- [x] Crons revisados: **sólo el incremental** queda croneado. El full se dispara desde la UI, que
      encadena; un cron no puede (una invocación, y el checkpoint TTL 24h expiraría antes).

### Pendientes derivados del despliegue

- [ ] **DP-01** — Crear el segundo proyecto Supabase de tests y dejar `TEST_DATABASE_URL` documentada
      donde el equipo la vea. Sin ella, `tests/integration/db.pg.test.ts` (única cobertura del SQL
      real) **se salta en silencio** — no hay señal de que no corrió.
- [ ] **DP-02** — Rotar el password de la base de Supabase (se compartió en un canal no seguro
      durante el setup del 2026-07-28) y actualizar `DATABASE_URL` en Vercel y `.env.local`.
- [ ] **DP-03** — Evaluar si el modelo cloud-only necesita mitigación: hoy un `npm run dev` escribe
      en la base que ven los colaboradores y un Full local reconstruye el snapshot de producción.
      Opción: proyecto Supabase de desarrollo aparte (revierte parte de ADR-0007 §1).
- [ ] **DP-04** — Vercel Hobby es, por términos de servicio, para uso personal/no comercial. Decidir
      si se pasa a Pro cuando esto deje de ser una prueba con colaboradores.
