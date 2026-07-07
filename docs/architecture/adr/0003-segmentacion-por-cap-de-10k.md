# ADR-0003 — Segmentación del full sync por el cap de 10k de Notion

- **Estado:** Aceptada
- **Fecha:** 2026-05-18
- **Fuentes:** acta `202605181515_session_changes.md` §5; `src/lib/notion.ts` (`fetchFullBatches`)

## Contexto

La API de Notion limita **cualquier** query a 10,000 resultados, incluso paginando con cursor hasta `has_more=false`. Se confirmó empíricamente: con 18,115 registros en la base, la paginación se detuvo exactamente en 10,000. La base real supera ese cap (~19.6k–21k filas), así que un full sync de una sola query es imposible.

## Decisión

El full sync se ejecuta como **bucle de segmentos**:

1. Cada segmento consulta con `sorts: [{ timestamp: "created_time", direction: "descending" }]`.
2. Si un segmento entrega 10,000 resultados, el `created_time` del último page se vuelve **pivote** del siguiente segmento con filtro `{ created_time: { on_or_before: <pivote> } }`.
3. El solape del registro frontera (el `on_or_before` es inclusivo) es inocuo: el cache es un HSET por `page.id`, idempotente.
4. Protección anti-loop si todos los registros del segmento comparten timestamp (`lastCreatedTime === pivot` → terminar).
5. El bucle termina cuando un segmento devuelve `< 10,000` resultados.

Se elige `created_time` (y no `last_edited_time`) como eje porque es **inmutable**: una edición durante el full no mueve registros entre segmentos.

El modo **incremental** no se segmenta: filtra por `last_edited_time > since` y asume que una ventana no acumula >10k ediciones (riesgo residual documentado en `docs/to-dos.md`).

## Consecuencias

- (+) Escala a 30k, 50k, etc. sin tocar código.
- (+) El pivote es un checkpoint natural para reanudar (base del fix FX-004, ver ADR-0005).
- (−) Un full de la base real siempre cruza al menos un límite de segmento; a 3 req/s el full completo toma minutos.
- (−) Costo de complejidad en `fetchFullBatches` (bucle externo de segmentos + bucle interno de cursor).
