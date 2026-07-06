# To-dos — ExportNotion

> Pendientes para mejorar la app, en **orden cronológico de ejecución**. Fuentes: incident report [202606101520](reports/202606101520_incident_report_sync_incremental.md) (FX-xx), update plan [202606101335](reports/202606101335_update_plan.md) (UP-xx) y pendientes registrados en `CLAUDE.md`/`README.md`. Marcar al completar; cuando una sección entera cierre, moverla al final como histórico.
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
- [ ] **UP-06** — Resolver `loadConfig()`: invocarla en el arranque (fail-fast con env vars faltantes) o documentar que es solo apoyo de tests.
- [ ] Consolidar `src/lib/auth.ts` y `src/lib/session.ts` (dos fuentes de opciones de sesión que pueden divergir; middleware importa de una, routes de la otra).
- [ ] Renombrar `src/middleware.ts` → `src/proxy.ts` (deprecation Next 16).
- [ ] Hacer el E2E corrible en local sin Upstash real (inyectar fakes donde hoy `Redis.fromEnv()` revienta el handler en la primera request).

## 4. Documentación y DX (baja prioridad)

- [ ] **UP-05** — Extraer ADRs numerados de las actas archivadas (whitelist, Data Source ID, cap 10k → segmentación, espera inline, revert del presupuesto) a `docs/architecture/adr/`.
- [ ] **UP-07** — Guía `docs/guides/cambiar-columnas.md`: migración de `COLUMNS`/`DATE_COLUMN` (impacto en cache/CSV).
- [ ] **UP-08** — `CONTRIBUTING.md` mínimo (convención de commits, tests requeridos).

## 5. ⏸️ Diferido — despliegue (retomar cuando lo local esté perfecto)

> La plataforma sigue abierta (Vercel u otra); no invertir aquí todavía.

- [ ] Decidir plataforma de despliegue. Si es Vercel: Hobby vs Pro (`maxDuration` 60s vs 300s).
- [ ] Si Vercel Hobby: activar `SYNC_BUDGET_MS` (queda listo con FX-004) y evaluar un segundo cron que encadene los segmentos del full (hoy con >10k filas requiere pulsar Full en la UI).
- [ ] Revisar los crons de `vercel.json` (horarios y encadenamiento) según la plataforma elegida.
