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

## 12. Ajustes para deploy en Vercel Hobby

Al intentar el primer deploy, dos errores reales bloquearon la publicación. Quedaron resueltos:

### 12.1 Frecuencia de crons incompatible con Hobby

`vercel.json`: el cron `0 */6 * * *` (incremental cada 6 h) era rechazado por Vercel con `Hobby accounts are limited to daily cron jobs`. En Hobby cada expresión solo puede correr una vez al día.

Cambio:

- `full` → `0 9 * * *` (09:00 UTC, sin cambio).
- `incremental` → `0 21 * * *` (21:00 UTC, 12 h después del full).

Esto da dos refrescos diarios. Si se necesita un refresco puntual fuera de horario, el botón **Refrescar incremental** sigue disponible en la UI.

Para volver al `*/6` (o más fino) hay que upgradear a Pro.

### 12.2 Error de tipo TS en `getAllRows`

`src/lib/cache.ts`: `next build` falla bajo strict TS con:

```
This comparison appears to be unintentional because the types 'string' and 'number' have no overlap.
  } while (cursor !== "0" && cursor !== 0);
```

El cursor estaba tipado `string | number` pero se asignaba siempre a string (`cursor = next`), dejando la comparación contra `0` como inalcanzable según el flow analysis. `HSCAN` en `@upstash/redis` siempre devuelve cursor como string, así que se normaliza:

```ts
let cursor: string = "0";
// ...
cursor = String(next);
} while (cursor !== "0");
```

`tsc --noEmit` pasa limpio. El build de Vercel también.

## Operación: deploy en Vercel

1. **Importar el repo** en `vercel.com/new`. Next.js se detecta solo.
2. **Env vars** (scope Production, y Preview si quieres deploys de PR):

   | Variable | Valor |
   |---|---|
   | `NOTION_TOKEN` | integration token |
   | `NOTION_DATABASE_ID` | data source ID (no database ID) |
   | `DATE_COLUMN` | `Hora de creación` |
   | `APP_PASSWORD_HASH` | bcrypt — aquí **sin escapar** los `$`, la UI de Vercel no usa dotenv-expand |
   | `SESSION_SECRET` | hex de 32 bytes |
   | `CRON_SECRET` | hex de 32 bytes |
   | `UPSTASH_REDIS_REST_URL` | de Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | de Upstash |

3. **Plan**: en Hobby `maxDuration` está capada a 60 s y los crons son diarios. El full de 18k tarda ~67 s, así que **en Hobby el cron del full probablemente se corta**. Mitigaciones:
   - Bajar `maxDuration` a 60 en `src/app/api/sync/route.ts:9` si te quedas en Hobby.
   - Disparar fulls manuales desde la UI (la UI muestra progreso y permite cancelar).
   - Upgradear a Pro cuando empiece a doler — sube el límite a 300 s y permite crons sub-diarios.

4. **Primer Full manual**: tras el primer deploy el cache está vacío y `/api/export` responde `503 no_data`. Login → botón **Full**. Tras ~70 s la descarga funciona.

5. **Verificar crons** en Project Settings → Cron Jobs después del deploy.

## ¿Dockerizar?

No conviene para este proyecto. Vercel ejecuta Next.js nativamente, ignora el Dockerfile y los crons solo existen como feature de Vercel (`vercel.json`). Docker solo agregaría complejidad operativa sin ganancia. Tendría sentido si se migrara a Fly/Railway/k8s/self-host.

## 13. Confiabilidad del sync en Vercel Hobby — full chunkado

Problema observado en producción tras el deploy: el sync se quedaba "trabado" en la UI aunque el backend estaba idle. Root cause investigado:

- El handler hacía `void runSync(kind)` y devolvía 202.
- En Vercel serverless, **la función se mata al responder**. El `runSync` en background quedaba en el aire y a veces no completaba (especialmente el Full a ~70 s contra el cap de 60 s de Hobby).
- Resultado: status `running`, pero ningún proceso trabajando. Sólo el TTL del lock (600 s) liberaba el estado.

### 13.1 Primer intento (no suficiente): chunking por segmentos de 10k

Se reemplazó el "void background" por:

- `fetchOneFullSegment(pivot?)`: procesa un segmento DESC por `created_time` con filtro `on_or_before: pivot`. Devuelve `nextPivot` para reanudar o `null` si fue el último.
- `runFullSegment`: una llamada = un segmento. Guarda pivote en `notion:sync:full:pivot` (TTL 24 h).
- `POST /api/sync` **awaitea el sync inline** y devuelve `{ done: bool }`.
- Cliente (page.tsx): repite POST hasta `done:true`, tope 20 segmentos.

**Pero seguía fallando** en producción con dos bugs:

1. **Sin presupuesto de tiempo**: el segmento iteraba hasta llenar 10 k o hasta `has_more=false`. Si Vercel mataba la función a los 60 s a medio segmento, no retornaba: nada se upserteaba ni se fijaba el pivote.
2. **Borrado del `new` al reanudar**: el "primer segmento" se detectaba por ausencia de pivote. Si el primer segmento moría antes de fijar el pivote, la siguiente llamada lo trataba como "primer segmento" y borraba el `new` (perdiendo lo acumulado). Eventualmente promovía un `new` parcial → el cache vivo bajó de 18 k a 2 k.
3. **Promote prematuro**: `nextPivot=null` se devolvía si el segmento traía < 10 k aunque la causa fuera timeout, no agotamiento. Eso disparaba la rama de "completado" y promovía datos incompletos.

### 13.2 Fix final

#### `fetchOneFullSegment` con presupuesto de tiempo

`src/lib/notion.ts`:

- Nueva opción `timeBudgetMs` (default 25 s). El loop chequea presupuesto antes de cada página y rompe limpio si lo excede.
- `isDone` (= `nextPivot=null`) **sólo** si `has_more=false` Y `segmentCount < NOTION_QUERY_CAP` Y no se canceló. En cualquier otro caso devuelve `lastCreatedTime` como `nextPivot` para reanudar.
- Anti-loop: si `lastCreatedTime === opts.pivot` (todos los registros del segmento compartían timestamp y no avanzamos), se marca como done para evitar bucle infinito.

#### Session flag separado del pivote

`src/lib/cache.ts`: nuevo key `notion:sync:full:session` (TTL 24 h).

- `isFullSessionActive()`: `true` si hay un full en curso.
- `startFullSession()`: marca la session al inicio de un full fresco.
- `endFullSession()`: limpia al completar (o cancelar).

`src/lib/sync.ts`:

- `isFirstSegmentOfSession` se determina por **ausencia de session**, no por ausencia de pivote. Eso garantiza que mid-flight (segmento 1 cortado antes de fijar pivote) la próxima llamada NO borre el `new`.
- `clearNewCache` y `clearCancel` se ejecutan SÓLO al abrir session nueva.
- El upsert al `new` ocurre **antes** de fijar el pivote: si el proceso muere ahí, la próxima llamada re-fetchea desde el pivote anterior (HSET es idempotente, no hay duplicados).
- `promoteNewCache` sólo se ejecuta al cerrar la sesión: cuando `nextPivot=null` (completado natural) o cuando hay `cancelled=true`. En ambos casos `endFullSession()` después.

#### Cliente con presupuesto de reintentos

`src/app/page.tsx`:

- `trigger(kind)` itera hasta 20 segmentos. Cada uno es un POST que awaitea ~25-35 s.
- Refresca status entre llamadas para mostrar progreso.

### 13.3 Comportamiento con crons en Hobby

El cron diario `full` (09:00 UTC) sólo ejecuta UN segmento. Para datasets > 10 k, el cron no completa el full por sí solo — el usuario debe abrir la UI y pulsar Full para que el cliente encadene los segmentos restantes. Alternativas:

- Agregar un segundo cron a las 09:05 UTC (Hobby permite múltiples expresiones diarias, sólo limita a 1 ejecución/día por expresión).
- Confiar en que el incremental diario (21:00 UTC) capture las ediciones; reservar el full chunkado para reconstrucciones manuales mensuales.
- Upgradear a Pro: `maxDuration` a 300 s permite el modelo monolítico anterior.

### 13.4 Procedimiento de recuperación de estado inconsistente

Si el sync se reporta `running` pero está muerto, o si el cache vivo está corrupto:

```bash
node -e "
const fs = require('fs');
const env = fs.readFileSync('.env.local','utf8').split(/\r?\n/);
for (const line of env) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^['\"]|['\"]$/g,''); }
const {Redis} = require('@upstash/redis');
const r = Redis.fromEnv();
(async () => {
  await r.del('notion:sync:lock','notion:sync:cancel','notion:sync:full:pivot','notion:sync:full:session','notion:cache:v1:new');
  await r.set('notion:sync:status', {state:'idle',kind:null,done:0,total:0,startedAt:null,error:null,skipped:0});
  console.log('reset OK');
})();
"
```

Luego disparar **Full** desde la UI. Si el cache vivo está corrupto, NO se restaura sin un full exitoso — el script de reset no toca `notion:cache:v1`.

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
