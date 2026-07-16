# To-dos — ExportNotion

## 1. Multi-BD (menú listo 2026-07-16; backend pendiente)

> El menú principal (`/` → tarjetas desde `src/lib/databases.ts`) y las rutas por BD (`/db/tiempos`, `/db/tiempos/reports`) ya existen; el backend sigue single-DB.

- [ ] **MB-02** — Soporte multi-BD real en el backend (cuando haya una segunda BD que integrar): config por BD (token / data source id / columnas / whitelist), snapshot por BD (columna `db_id` o tabla por BD), sync y crons por BD, APIs parametrizadas por slug.

## 2. ⏸️ Diferido — despliegue (retomar cuando lo local esté perfecto)

> La plataforma sigue abierta (Vercel u otra); no invertir aquí todavía. Supabase no condiciona esta decisión: funciona igual desde cualquier plataforma.

- [ ] Decidir plataforma de despliegue. Si es Vercel: Hobby vs Pro (`maxDuration` 60s vs 300s).
- [ ] Si Vercel Hobby: activar `SYNC_BUDGET_MS` (queda listo con FX-004) y evaluar un segundo cron que encadene los segmentos del full (hoy con >10k filas requiere pulsar Full en la UI).
- [ ] Revisar los crons de `vercel.json` (horarios y encadenamiento) según la plataforma elegida.
