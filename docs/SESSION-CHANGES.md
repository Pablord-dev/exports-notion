# Cambios de sesión — Setup y endurecimiento para MVP

Fecha: 2026-05-18

Esta sesión llevó al proyecto desde un primer intento de login local hasta un MVP funcional con full sync robusto, descarga ordenada y UI con feedback. Documenta los cambios para que cualquiera pueda entender por qué cada decisión existe.

## 1. Configuración de columnas exportables

`src/lib/columns.ts`: Whitelist poblada con las 21 propiedades reales de la base `BD Tiempos` en Notion. El orden de la lista es el orden del CSV. Todas las columnas usan el mismo nombre en Notion y en el CSV (sin override `csv:`).

Lista actual: `Breve descripción`, `Empresa productiva`, `Hecho por`, `Hecho por (no tocar)`, `Hito`, `Hito (no tocar)`, `Hora de creación`, `Hora de finalización`, `Hora de última edición`, `ID`, `Persona`, `Proyecto`, `Proyecto (no tocar)`, `Registro de horas`, `Subproyecto`, `Subproyecto (Nombre)`, `Subproyecto (no tocar)`, `Tarea`, `Tarea (no tocar)`, `Último editor`, `Validación`.

## 2. Variable `DATE_COLUMN`

`Hora de creación` se eligió como columna canónica para el filtro `?from&to` del endpoint `/api/export` y para el orden ascendente del CSV.

## 3. Tipos de propiedad adicionales soportados en el flattener

`src/lib/flatten.ts`: el schema usa tipos que el flattener original no manejaba. Se agregaron:

- `unique_id` → `<prefix>-<number>` (ej. `TM-123`).
- `created_by` → nombre del user (cae a id si la integración no tiene "Read user information").
- `last_edited_by` → idem.

Sin esto, los campos `ID`, `Persona` y `Último editor` salían vacíos en el CSV.

## 4. Notion: data source ID vs database ID

`@notionhq/client` v5 usa `dataSources.query`, no `databases.query`. El env var `NOTION_DATABASE_ID` debe contener el **data source ID**, no el database ID histórico.

Obtención manual: `GET https://api.notion.com/v1/databases/<DB_ID>` con header `Notion-Version: 2025-09-03` → `data_sources[0].id`.

## 5. Cap de 10,000 resultados por query en Notion

Toda query a `dataSources.query` está limitada a 10,000 resultados, incluso paginando con cursor. Esto se confirmó empíricamente al iterar hasta `has_more=false` y obtener exactamente 10,000 (cuando la base ya tenía 18,115 registros).

### Solución: segmentación por pivote en `src/lib/notion.ts`

El modo **full** se reescribió como bucle de **N segmentos**:

1. Cada segmento consulta `sorts: [{ timestamp: "created_time", direction: "descending" }]`.
2. Cuando un segmento entrega 10,000 resultados, se usa el `created_time` del último page como pivote del siguiente con filtro `{ timestamp: "created_time", created_time: { on_or_before: <pivote> } }`.
3. Se mantiene un `Set<id>` de páginas vistas para deduplicar el registro frontera (que aparece en ambos segmentos por el `on_or_before` inclusivo).
4. Se incluye protección anti-loop si todos los registros comparten el mismo timestamp.
5. El bucle termina cuando un segmento devuelve `<10,000` resultados.

Para tus 18k actuales son 2 segmentos × ~100 reqs paginadas a 3 req/s ≈ 67 s, dentro del `maxDuration=300` del sync. Escala a 30k, 50k, etc. sin tocar código.

El modo **incremental** sigue usando un solo segmento filtrado por `last_edited_time > since`; se asume que las ediciones por ciclo no superan 10k.

## 6. Cache Upstash: chunking y lectura paginada

`src/lib/cache.ts`. Se descartó una hipótesis temprana de límite de 10k campos por hash en Upstash free (era falsa correlación con el cap de Notion). Aun así, se conservaron dos mejoras legítimas:

- **`upsertRows` / `deleteRows`** chunkean en lotes de 500 campos por HSET/HDEL. Evita request bodies enormes a la API REST.
- **`getAllRows`** usa `HSCAN` con páginas de 500. Antes traía todo con `HVALS` en una sola request, lo que con ~18k filas reventaba el socket de fetch (`UND_ERR_SOCKET: other side closed`).

## 7. Auto-parseo de JSON en Upstash REST

El cliente `@upstash/redis` auto-parsea valores que parecen JSON al leer. `getAllRows` hace ahora `typeof v === "string" ? JSON.parse(v) : v` para soportar ambos casos. Antes, llamar `JSON.parse` sobre el objeto ya parseado lo coaccionaba a `"[object Object]"` y lanzaba `SyntaxError`.

## 8. Orden ascendente por fecha en el CSV

`src/app/api/export/route.ts`: tras leer del cache, se ordena en memoria por `DATE_COLUMN` (= `Hora de creación`) con `localeCompare` sobre el string ISO. Esto **es** lo que garantiza el orden del archivo final — el cache es un hash de Redis sin orden, así que ordenar solo en la query de Notion no se reflejaría.

## 9. Cancelación de sync en curso

Nuevo flujo: el usuario puede abortar un Full sync y conservar lo ya cargado.

### Backend

- `src/lib/cache.ts`: helpers `requestCancel`, `isCancelRequested`, `clearCancel` con key `notion:sync:cancel` (TTL 1 h).
- `src/lib/notion.ts`: `FetchOptions.shouldCancel?: () => boolean | Promise<boolean>`. Se consulta entre páginas y entre segmentos, conservando todo lo recolectado.
- `src/lib/sync.ts`: limpia el flag al arrancar; pasa la señal a `fetchPages`. Si hay páginas → upsert + promote (incluso parcial). Si llegaron 0 páginas, no promueve (protege el cache previo).
- `src/app/api/sync/route.ts`: nuevo handler `DELETE` que llama `requestCancel()`. Reutiliza `isAuthorized` (cookie OR `Bearer $CRON_SECRET`).

### UI

Botón "Cancelar y guardar lo cargado" visible mientras `state === "running"`.

⚠️ Si cancelas un Full con 5k de 18k, el cache queda con 5k hasta el siguiente full. Es intencional.

## 10. UI con feedback en todos los botones

`src/app/page.tsx`: cada acción asincrónica tiene su flag de loading propio. Todos los botones se desactivan mientras corre la acción y muestran un texto alternativo.

| Botón | Estado pressed | Behavior |
|---|---|---|
| Entrar | "Entrando…" | Disabled durante el POST |
| Refrescar incremental | "Iniciando…" | Disabled ambos botones de sync |
| Full | "Iniciando…" | Disabled ambos botones de sync |
| Cancelar | "Cancelando…" | Disabled mientras se procesa |
| Descargar | "Descargando…" | Disabled hasta que el blob esté listo |
| Cerrar sesión | "Saliendo…" | Disabled durante el DELETE |

El botón **Descargar** ya no es un `<a href>`. Ahora fetchea el blob, extrae el filename del `Content-Disposition` y dispara la descarga con `URL.createObjectURL`. Como bonus, los errores del export (ej. `no_data` 503) se muestran como mensaje en rojo en vez de descargar un JSON raro.

El estado "Iniciando…" de los syncs se limpia automáticamente cuando el polling detecta `state === "running"` desde el server.

## 11. Cerrar sesión desde la UI

El endpoint `DELETE /api/login` ya existía. Se agregó un botón "Cerrar sesión" arriba a la derecha del header.

## Operación: setup local

1. Copiar `.env.example` → `.env.local`.
2. Generar secretos:
   ```bash
   node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex')); console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
   ```
3. **`APP_PASSWORD_HASH` debe ir con `$` escapados**: `APP_PASSWORD_HASH=\$2b\$10\$....`. Sin escape, Next.js (`dotenv-expand`) interpreta `$2b`, `$10`, etc. como variables vacías y el hash se carga corrupto. Las comillas simples no funcionan — solo el escape.
4. `NOTION_DATABASE_ID` debe ser un **data source ID**, no un database ID.
5. `DATE_COLUMN` debe coincidir exactamente con una entrada de la whitelist (`Hora de creación`).
6. `npm run dev` → login → primer Full sync manual → descargar.

## Operación: destrabar un sync interrumpido en dev

Si reinicias el dev server con un sync en curso, el lock queda colgado hasta el TTL (600 s). Para liberarlo manualmente:

```bash
node -e "
require('@next/env').loadEnvConfig(process.cwd());
const {Redis} = require('@upstash/redis');
const r = Redis.fromEnv();
(async () => {
  await r.del('notion:sync:lock');
  await r.del('notion:sync:cancel');
  await r.del('notion:cache:v1:new');
  await r.set('notion:sync:status', {state:'idle',kind:null,done:0,total:0,startedAt:null,error:null,skipped:0});
  console.log('reset OK');
})();
"
```

El cache principal (`notion:cache:v1`) **no se toca**.
