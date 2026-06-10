# Índice de documentación — ExportNotion

> Una línea por documento. Los archivos con prefijo `AAAAMMDDHHMM_` son instantáneas fechadas; los de nombre estable se mantienen vivos.

## Raíz del repo

- [README.md](../README.md) — setup local, tests, deploy a Vercel y notas operativas (audiencia: dev).
- [CLAUDE.md](../CLAUDE.md) — arquitectura operativa, endpoints, claves Redis, límites de plataforma y modo de trabajo (audiencia: agentes IA / dev).

## brief/ — discovery vigente (Capa 1, reutilizable por flows)

- [202606101335_project_brief.md](brief/202606101335_project_brief.md) — brief del proyecto, fingerprint `d39da8d` (2026-06-10).
- [202606101335_architecture_map.json](brief/202606101335_architecture_map.json) — mapa estructurado de componentes, flujos e integraciones.
- [202606101335_doc_coverage.json](brief/202606101335_doc_coverage.json) — cobertura documental, gaps y contradicciones.

## guides/ — how-to

- [manual-usuario.md](guides/manual-usuario.md) — manual de usuario en español con screenshots (login, dashboard, sync, descarga CSV).

## reports/ — entregables fechados de flows

- [202606101335_doc_gap_report.md](reports/202606101335_doc_gap_report.md) — auditoría documental FL-DOC-01: cobertura, gaps y contradicciones.
- [202606101335_update_plan.md](reports/202606101335_update_plan.md) — plan priorizado de actualización documental (UP-01…UP-08 pendientes).

## archive/ — instantáneas congeladas (no se actualizan)

- [202605170000_notion_export_webapp_design_spec.md](archive/202605170000_notion_export_webapp_design_spec.md) — spec de diseño original pre-implementación (2026-05-17; dice Next 15, crons 6h).
- [202605170000_notion_export_webapp_plan.md](archive/202605170000_notion_export_webapp_plan.md) — plan de implementación original, 22 tareas (truncado en la task 9).
- [202605181515_session_changes.md](archive/202605181515_session_changes.md) — acta 2026-05-18: 13 decisiones del MVP (whitelist, cap 10k, chunking, deploy).
- [202606051159_session_changes.md](archive/202606051159_session_changes.md) — acta 2026-06-05: recuperación de sync trabado y revert del presupuesto/session flag.
- [202606041013_project_brief.md](archive/202606041013_project_brief.md) — brief anterior (fingerprint `5a3edd8`), reemplazado por el de 2026-06-10; con sus JSONs hermanos `202606041013_{architecture_map,doc_coverage}.json`.
