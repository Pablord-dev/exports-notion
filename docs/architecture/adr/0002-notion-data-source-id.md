# ADR-0002 — `NOTION_DATABASE_ID` contiene un Data Source ID (SDK v5)

- **Estado:** Aceptada
- **Fecha:** 2026-05-18
- **Fuentes:** acta `202605181515_session_changes.md` §4; `src/lib/notion.ts`

## Contexto

`@notionhq/client` v5 (API `Notion-Version: 2025-09-03`) reemplazó `databases.query` por `dataSources.query`: una database de Notion ahora puede tener varios *data sources* y las queries van contra el data source, no contra la database. El ID histórico de database ya no sirve para consultar.

## Decisión

Conservar el nombre de la env var `NOTION_DATABASE_ID` (compatibilidad con el setup existente) pero **su valor debe ser un Data Source ID**. Obtención manual:

```
GET https://api.notion.com/v1/databases/<DB_ID>
Notion-Version: 2025-09-03
→ data_sources[0].id
```

## Consecuencias

- (+) Sin migración de nombres de env vars.
- (−) Trampa documentada: pegar el database ID clásico produce errores de query difíciles de diagnosticar. El README (§Setup local) y CLAUDE.md lo advierten.
- Nota posterior (2026-07-06): en esta versión de API el body de `data_sources/{id}/query` rechaza `in_trash`/`archived` y el parámetro real `is_archived` **particiona** vivas/papelera — ver addendum del incident report `202606101520` y el fix FX-001.
