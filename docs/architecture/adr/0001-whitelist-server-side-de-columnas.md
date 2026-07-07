# ADR-0001 — Whitelist server-side de columnas exportables

- **Estado:** Aceptada
- **Fecha:** 2026-05-17 (spec de diseño) · poblada con el schema real el 2026-05-18
- **Fuentes:** `docs/archive/202605170000_notion_export_webapp_design_spec.md` §1, §4; acta `202605181515_session_changes.md` §1

## Contexto

La base de Notion (`BD Tiempos`) contiene propiedades que no deben ser visibles ni descargables por los usuarios de la webapp (columnas privadas / internas). El cliente web no es de confianza: cualquier mecanismo donde el navegador pida columnas por nombre permitiría exfiltrar propiedades no previstas.

## Decisión

Las columnas exportables se definen **server-side** en `src/lib/columns.ts` (`COLUMNS: ColumnDef[]`). El cliente jamás pide columnas: recibe exactamente las de la lista.

- El **orden** de la lista es el orden de columnas del CSV.
- Cada entrada admite un alias opcional `csv:` para renombrar el header (default: mismo nombre que en Notion).
- La whitelist se aplica **al aplanar** (`flatten.ts`, en sync): al cache de Redis sólo entran las columnas listadas — una propiedad no listada no existe ni siquiera en el cache.
- Editar esta lista es la operación de configuración normal por proyecto (ver `docs/guides/cambiar-columnas.md`).

## Consecuencias

- (+) Propiedades privadas nunca salen del server; ni el CSV ni el cache las contienen.
- (+) Un solo archivo controla contenido y orden del export.
- (−) Agregar una columna requiere **full sync** para re-aplanar las filas viejas del cache (detalle en la guía).
- (−) `DATE_COLUMN` debe pertenecer a la whitelist; si no, `/api/export` responde `500 date_column_not_in_whitelist`.
