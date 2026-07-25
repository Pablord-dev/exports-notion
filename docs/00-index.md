# Índice de documentación — ExportNotion

> Una línea por documento. Los archivos con prefijo `AAAAMMDDHHMM_` son instantáneas fechadas; los de nombre estable se mantienen vivos.

## ¿Qué leer primero?

- **Vas a usar la app** → [guides/manual-usuario.md](guides/manual-usuario.md).
- **Vas a desarrollar** → [README.md](../README.md) (setup) y luego [CLAUDE.md](../CLAUDE.md) (arquitectura y límites).
- **Quieres el estado actual del proyecto** → [brief/](#brief--discovery-vigente-capa-1-reutilizable-por-flows) y el incident report vigente en [reports/](#reports--entregables-fechados-vigentes).
- **Buscas el porqué de una decisión** → [architecture/adr/](architecture/adr/README.md) — decisiones destiladas; la evidencia completa vive en archive/.
- **Buscas historia o decisiones pasadas** → [archive/](#archive--instantáneas-congeladas-no-se-actualizan).
- **Quieres saber qué sigue** → [to-dos.md](to-dos.md) — pendientes en orden cronológico de ejecución.

## Raíz del repo

- [README.md](../README.md) — setup local, tests, deploy a Vercel y notas operativas (audiencia: dev).
- [CLAUDE.md](../CLAUDE.md) — arquitectura operativa, endpoints, esquema de Postgres, límites de plataforma y modo de trabajo (audiencia: agentes IA / dev).
- [CONTRIBUTING.md](../CONTRIBUTING.md) — convención de commits, verificación requerida y reglas del proyecto.
- [scripts/](../scripts/) — herramientas operativas: `reset-sync-state.cjs` (destrabar un sync trancado) y `check-cache-drift.cjs` (detectar cache desactualizado vs. Notion).

## architecture/ — decisiones vivas

- [adr/README.md](architecture/adr/README.md) — índice de ADRs: whitelist (0001), Data Source ID (0002), segmentación 10k (0003), espera inline (0004), presupuesto opcional (0005), migración a Postgres/Supabase (0006).

## brief/ — discovery vigente (Capa 1, reutilizable por flows)

- [202607241807_project_brief.md](brief/202607241807_project_brief.md) — brief del proyecto, fingerprint `15ab3fa` (2026-07-24): Postgres/Supabase, reportes v1 + matriz, Asistente IA.
- [202607241807_architecture_map.json](brief/202607241807_architecture_map.json) — mapa estructurado de componentes, flujos e integraciones.
- [202607241807_doc_coverage.json](brief/202607241807_doc_coverage.json) — cobertura documental, gaps y contradicciones.

## guides/ — how-to

- [manual-usuario.md](guides/manual-usuario.md) — manual de usuario en español con screenshots (login, dashboard, sync, descarga CSV).
- [cambiar-columnas.md](guides/cambiar-columnas.md) — cómo agregar/quitar/renombrar columnas exportadas y cambiar `DATE_COLUMN` (impacto en cache/CSV, cuándo hace falta Full).

## reports/ — entregables fechados vigentes

> Cuando un reporte queda superado (plan ejecutado, incidente cerrado), se mueve a `archive/`.

- [202607081002_reportes_v1_spec.md](reports/202607081002_reportes_v1_spec.md) — **vigente, alimenta la migración a Supabase (SB-xx)**: spec aprobado de los reportes v1 (horas por persona/subproyecto, evolución temporal, drill-down, API y esquema implicado).
- [202606101520_incident_report_sync_incremental.md](reports/202606101520_incident_report_sync_incremental.md) — **vigente, alimenta la rama `fix/incremental-sync`**: defectos D1–D3 del sync (papelera nunca borrada, `lastIncrementalAt` tardío, full no reanudable) y plan de fixes FX-001…FX-005.
- [202606101335_doc_gap_report.md](reports/202606101335_doc_gap_report.md) — auditoría documental FL-DOC-01: cobertura, gaps y contradicciones.
- [202606101335_update_plan.md](reports/202606101335_update_plan.md) — plan priorizado de actualización documental (UP-01…UP-08 pendientes).

## archive/ — instantáneas congeladas (no se actualizan)

- [202605170000_notion_export_webapp_design_spec.md](archive/202605170000_notion_export_webapp_design_spec.md) — spec de diseño original pre-implementación (2026-05-17; dice Next 15, crons 6h).
- [202605170000_notion_export_webapp_plan.md](archive/202605170000_notion_export_webapp_plan.md) — plan de implementación original completo, 22 tareas + notas (la copia de trabajo en `.planorch/` es un duplicado sin trackear).
- [202605181515_session_changes.md](archive/202605181515_session_changes.md) — acta 2026-05-18: 13 decisiones del MVP (whitelist, cap 10k, chunking, deploy).
- [202606051159_session_changes.md](archive/202606051159_session_changes.md) — acta 2026-06-05: recuperación de sync trabado y revert del presupuesto/session flag.
- [202606041013_project_brief.md](archive/202606041013_project_brief.md) — brief anterior (fingerprint `5a3edd8`), reemplazado por el de 2026-06-10; con sus JSONs hermanos `202606041013_{architecture_map,doc_coverage}.json`.
