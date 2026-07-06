# Incident Report — «El sync incremental no funciona correctamente»

> Generado por FL-DBG-01 (debugging) v1.1.0 · 2026-06-10 15:20 · rama `fix/incremental-sync`
> Brief reutilizado: `docs/brief/202606101335_project_brief.md` (fingerprint `d39da8d`, decisión `reuse` confirmada por el usuario)

## 1. Reproducción (AG-DBG-01 REPRODUCER)

```json
{
  "repro": {
    "is_reproducible": false,
    "expected": "ediciones/borrados de Notion reflejados en el CSV tras el incremental",
    "actual": "estado de producción SANO al momento del análisis: las 22 páginas editadas hoy (06:00–17:04 UTC) están frescas en el cache vivo; 0 páginas en papelera editadas en 14 días",
    "env": { "redis": "Upstash prod (solo lectura)", "notion": "data source real, 19,632 filas", "fecha": "2026-06-10 ~15:10 CST" },
    "determinism": "no observable — un full manual completo a las 20:48 UTC reparó cualquier inconsistencia previa",
    "assumptions": ["el full de las 20:48 UTC fue el workaround del usuario ante el síntoma original"]
  }
}
```

**Reclasificación del síntoma por el usuario** (escalación humana, gate 3→4): el incremental *sí funciona*. Las necesidades reales son:

- **R1**: no hay contador visible de cuántos registros procesó el último sync.
- **R2**: si el full sync se corta a mitad, hoy se reinicia desde el principio en vez de retomar donde se quedó (con >10k filas y la muerte de la función antes de fijar el pivote, además se borra el `:new` acumulado).
- Prioridad del usuario: **que funcione correctamente en local**; Vercel (Hobby) después.

## 2. Hallazgos con evidencia (AG-DBG-02 ROOT-CAUSE-ANALYZER)

Aunque el síntoma original no fue reproducible, el análisis encontró **defectos reales** del incremental:

### D1 — Las páginas archivadas/borradas jamás se eliminan vía incremental (confianza 0.95)

- `src/lib/notion.ts:69-75` — el query incremental no pasa `in_trash: true`. La API de Notion **excluye por defecto** las páginas en papelera de los resultados de `dataSources.query` (doc oficial: parámetro `in_trash` — *"Whether to include results that are in the trash"*).
- `src/lib/notion.ts:165` — el branch `if (r.archived) a.archivedIds.push(r.id)` es **código muerto en producción**: ninguna página llega con `archived: true`.
- `src/lib/sync.ts:114` — `deleteRows(archivedIds)` nunca borra nada.
- **Verificación empírica** (query de solo lectura contra la API real): `in_trash: true` devuelve vivas **+** papelera (semántica "incluir", no "solo papelera") → fix de una sola query.
- El test de integración pasa porque `tests/fixtures/fakeNotion.ts` devuelve archivadas en el query (infiel a la API) e ignora el filtro `since`.
- Consecuencia: registros borrados en Notion persisten en el CSV hasta un full **completo** — que con >10k filas el cron nunca termina por sí solo.

### D2 — lastIncrementalAt se fija al FINAL del fetch (confianza 0.85)

- `src/lib/sync.ts:115` — `lastIncrementalAt: new Date().toISOString()` al terminar. Las ediciones hechas *durante* un sync que duren más que el overlap de 60s (`OVERLAP_MS`, `src/lib/sync.ts:11`) quedan fuera de la próxima ventana → pérdida silenciosa y permanente.
- Agravante: `src/lib/sync.ts:82` — el full (que puede durar minutos u horas si se segmenta entre corridas) también fija `lastIncrementalAt = now` al promover; las ediciones a páginas de segmentos ya procesados se pierden.
- Agravante: `last_edited_time` de Notion viene **redondeado al minuto** (verificado empíricamente), lo que ensancha el borde del filtro `after`.
- Si el incremental se **cancela** a mitad, `lastIncrementalAt` se actualiza igual → lo no procesado se pierde.

### D3 — El full no es reanudable ante muerte de la función (= R2, confianza 0.9)

- `src/lib/sync.ts:43` — «primer segmento» se detecta por **ausencia de pivote**; el pivote se fija **solo al cerrar un segmento de hasta 10k** (`src/lib/sync.ts:71`).
- Si la función muere a mitad de un segmento (Vercel Hobby capa `maxDuration` a 60s y un segmento de 10k tarda ~35-60s+): no hay pivote nuevo → el siguiente intento se cree primer segmento → `clearNewCache()` (`src/lib/sync.ts:47`) **borra todo lo acumulado**.
- El upsert al `:new` ocurre **al final del segmento completo** (`src/lib/sync.ts:65`): todo el avance del segmento en curso se pierde con la función.
- Estado real observado: base con **19,632 filas** (>10k) — el cron full diario procesa 1 segmento y nunca completa solo; un pivote colgado (TTL 24h) hace que el siguiente full "reanude" un snapshot de hasta 24h de antigüedad y lo promueva mezclado.

## 3. Plan de corrección (AG-DBG-03 FIX-PLANNER)

| ID | Acción | Archivos | Ataca | Esfuerzo | Prioridad |
|---|---|---|---|---|---|
| FX-001 | Pasar `in_trash: true` en el query del incremental para que las páginas en papelera editadas desde `since` lleguen y `deleteRows` opere | `src/lib/notion.ts` | D1 | XS | high |
| FX-002 | Capturar `lastIncrementalAt` ANTES del fetch (incremental) y usar el `startedAt` del full al promover; no avanzar `lastIncrementalAt` si el incremental fue cancelado | `src/lib/sync.ts` | D2 | S | high |
| FX-003 | Persistir resumen del último sync (`status.lastResult`: kind, upserted, deleted, skipped, finishedAt) y mostrarlo en la UI | `src/lib/types.ts`, `src/lib/sync.ts`, `src/app/page.tsx` | R1 | S | high |
| FX-004 | Full reanudable: upsert progresivo por batch al `:new`, checkpoint de pivote por batch, flag de sesión `notion:sync:full:active` (primer segmento = ausencia del flag), presupuesto de tiempo opcional `SYNC_BUDGET_MS` por invocación | `src/lib/notion.ts`, `src/lib/sync.ts`, `src/lib/cache.ts` | D3/R2 | M | blocker |
| FX-005 | Fidelidad del fake de Notion (filtro `since`, `in_trash`, `created_time`+sorts) + tests de regresión | `tests/fixtures/*`, `tests/integration/sync.test.ts` | D1-D3 | S | high |

**Pruebas de regresión** (deben fallar antes del fix, pasar después):
1. Incremental con fake fiel: página archivada editada desde `since` → desaparece del cache (D1).
2. `lastIncrementalAt` ≤ instante de inicio del fetch (D2).
3. Tras incremental: `status.lastResult = {kind, upserted, deleted}` y `runSync` devuelve conteos (R1).
4. Full con presupuesto agotado: responde `done:false`, fija pivote, conserva `:new`; llamadas siguientes completan y promueven (R2).
5. Reintento tras muerte simulada a mitad de full: NO borra el `:new` acumulado (D3).
6. Cancel y full vacío: comportamiento existente intacto.

**Alternativas consideradas**: para D1, doble query (normal + solo-papelera) — descartada: verificado que `in_trash: true` incluye ambas. Para D3, encadenar segmentos desde un segundo cron — pospuesto: el usuario prioriza local; el mecanismo de presupuesto queda listo para Vercel con una env var.

## 3.1 Addendum (2026-07-06) — corrección a la verificación de D1

La "verificación empírica" de que `in_trash: true` funciona en `dataSources.query` **era incorrecta**: al implementar FX-001, el API real (Notion-Version `2025-09-03`, la que fija el SDK v5.21) respondió `validation_error 400: body.in_trash should be not present`. Hechos verificados contra el API real el 2026-07-06:

- `in_trash` y `archived` **no existen** en el body de `data_sources/{id}/query` (400 en ambos, también con `Notion-Version: 2026-03-11`), aunque los tipos del SDK los declaren.
- El parámetro real es **`is_archived`** y **particiona**: omitido/`false` = sólo vivas, `true` = sólo papelera. No hay flag de "incluir ambas".
- El SDK v5.21 **descarta `is_archived` en silencio** (no está en su whitelist interna de body params) — la query de papelera debe ir por `client.request()` crudo.

Por tanto FX-001 se implementó con la alternativa que este report descartó: **doble query** (vivas + sólo-papelera). El fake de tests reproduce estas reglas y convierte este hallazgo en regresión permanente.

## 4. Veredicto

- `is_reproducible: false` para el síntoma literal; reclasificado por el usuario a R1+R2.
- D1/D2/D3 confirmados con evidencia anclada (código + API real + estado de producción).
- Handoff: este fix_plan alimenta `FL-DEV-01` como `requirement_or_spec` (composición prevista por el flow).
