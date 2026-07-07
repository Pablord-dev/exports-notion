# Guía — Cambiar columnas exportadas (`COLUMNS` / `DATE_COLUMN`)

> La whitelist `src/lib/columns.ts` define **qué** propiedades de Notion se exportan y **en qué orden** (ADR-0001). La env var `DATE_COLUMN` define la columna de filtro/orden del export. Esta guía cubre el impacto de cambiarlas y el procedimiento correcto.

## Cómo fluyen las columnas (para entender el impacto)

1. **Sync** (`flatten.ts`): cada página de Notion se aplana a `{ header CSV → string }` usando la whitelist **vigente en ese momento**, y así se guarda en el cache de Redis. Propiedades fuera de la lista **no entran al cache**.
2. **Export** (`/api/export`): lee las filas ya aplanadas del cache y emite los headers de la whitelist **vigente al descargar**. No consulta Notion.

La consecuencia clave: **el cache guarda filas aplanadas con la whitelist de cuando se sincronizaron**. Cambiar `columns.ts` cambia los headers del CSV al instante, pero los *datos* de las filas viejas no se recalculan hasta re-sincronizarlas.

## Agregar una columna

1. Edita `src/lib/columns.ts` — inserta `{ notion: "Nombre exacto" }` en la posición deseada (el orden de la lista = orden del CSV). El nombre debe coincidir **exactamente** con la propiedad en Notion (sensible a mayúsculas y espacios).
2. Verifica que el **tipo** de la propiedad esté soportado por `flatten.ts`: title, rich_text, number, select, status, multi_select, date, checkbox, url, email, phone_number, people, relation, files, formula, rollup, created_time, last_edited_time, created_by, last_edited_by, unique_id. Un tipo no soportado produce siempre `""` (agrega el case en `flatten.ts` si hace falta).
3. Reinicia el server (dev o start) para recompilar.
4. **Corre un Full sync.** Hasta entonces, la columna nueva aparece en el CSV pero **vacía** para todas las filas cacheadas antes del cambio (el incremental sólo re-aplana lo editado desde la última ventana — no repara el histórico).

## Quitar una columna

1. Elimina la entrada de `columns.ts` y reinicia.
2. Efecto inmediato: el header desaparece del CSV — el export sólo emite columnas de la lista vigente.
3. No se necesita sync para el CSV. Los valores viejos quedan como datos residuales dentro del JSON de cada fila en Redis hasta el próximo Full (si la columna se quitó por privacidad y eso importa, corre un Full para purgarlos del cache).

## Renombrar el header del CSV (alias `csv:`)

`{ notion: "Hora de creación", csv: "Fecha" }` renombra el header sin tocar Notion. **Impacto igual que agregar**: las filas cacheadas guardan los valores bajo la key vieja, así que la columna renombrada sale vacía hasta un **Full sync**. Si `DATE_COLUMN` apunta a esa columna, el filtro/orden usa la key CSV — no cambies el alias sin correr el Full inmediatamente.

## Cambiar `DATE_COLUMN`

1. La nueva columna **debe estar en la whitelist**; si no, `/api/export` responde `500 date_column_not_in_whitelist`.
2. Debe contener valores de fecha comparables como string ISO (tipos `date`, `created_time`, `last_edited_time`): el filtro `?from&to` y el orden ascendente comparan strings.
3. Es una env var: edítala en `.env.local` y **reinicia el server** (el fail-fast de `instrumentation.ts` la exige presente).
4. No requiere sync: filtro y orden se aplican al momento del export sobre el cache existente.

## Checklist de verificación (cualquier cambio)

```bash
npm test              # la suite no depende del contenido de COLUMNS, pero valida flatten
npm run dev           # login → Full sync → descargar CSV
```

- Abre el CSV: headers en el orden esperado, columna nueva/renombrada **con datos** (si sale vacía, faltó el Full o el nombre no coincide con Notion).
- `node scripts/check-cache-drift.cjs` — opcional, confirma que el cache quedó fresco.
