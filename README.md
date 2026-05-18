# ExportNotion

Webapp interna para descargar contenido de una base de Notion como CSV, con filtro de rango de fechas y autenticación por password compartido.

## Stack

Next.js 16 (App Router, TS) · React 19 · Tailwind v4 · Upstash Redis · `@notionhq/client` v5 · iron-session v8 · Vitest 4 · Playwright

## Setup local

1. Copia `.env.example` a `.env.local` y rellena las variables.
2. Genera el hash bcrypt del password compartido:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "MI-PASSWORD"
   ```
3. Edita `src/lib/columns.ts` con la whitelist real de propiedades de tu base.
4. Ajusta `DATE_COLUMN` al nombre exacto de la propiedad fecha (debe estar también en la whitelist).
5. **`NOTION_DATABASE_ID`:** desde el SDK v5 esta variable debe contener un **Data Source ID**, no el ID antiguo de database. Para obtenerlo: abre tu base de Notion como página, copia su `database_id`, luego `GET https://api.notion.com/v1/databases/<id>` con tu integration token y usa `data_sources[0].id`.
6. Levanta dev:
   ```bash
   npm install
   npm run dev
   ```

## Tests

```bash
npm test                # unit + integration (Vitest)
npm run test:e2e        # Playwright smoke (requiere env vars de Upstash o el server se cae al hacer rate limit)
```

> El smoke E2E asume que `/api/login` puede responder. En dev local sin Upstash, `Redis.fromEnv()` falla al intentar la primera request y el handler crashea — el test fallará. Configura Upstash o usa stubs para correrlo localmente.

## Deploy a Vercel

1. Conecta el repo a Vercel.
2. Configura **todas** las env vars del `.env.example` en Project Settings (incluye los `UPSTASH_*` reales).
3. Push a `main` → Vercel deploya y activa los crons del `vercel.json`.
4. **Primer sync:** después del primer deploy, entra a la app, haz login y aprieta "Full". Sin ese primer sync el `/api/export` responde 503.

## Operación

- **Cron incremental**: cada 6h (`0 */6 * * *` UTC).
- **Cron full**: diario 09:00 UTC (03:00 CDMX).
- **Botón "Full"**: usa cuando sospeches drift (borrados no detectados).
- **Estado y errores de sync**: visibles en la UI (último sync, próximo cron, progreso, último error).

## Seguridad

- Password compartido (bcrypt) + cookie `httpOnly` firmada (iron-session).
- Rate limit 5 intentos / 15 min por IP (Upstash Ratelimit).
- Whitelist server-side (`src/lib/columns.ts`): el cliente nunca puede pedir columnas fuera de la lista.
- Cron auth: header `Authorization: Bearer <CRON_SECRET>`.

## Notas técnicas

- **Vercel free tier**: `maxDuration` está en 60s (export) y 300s (sync). El sync incremental siempre cabe; el full tarda ~40s para 11k registros. Si el full no termina, el lock libera por TTL (10 min) y el siguiente cron retoma — pero se recomienda plan Pro para mayor margen.
- **Empty data source en primer sync**: `runFull` ya maneja correctamente el caso de 0 páginas (no borra el cache previo, sólo actualiza `lastFullAt`).
- **Deprecation Next 16**: el archivo `src/middleware.ts` emite un warning sugiriendo renombrar a `src/proxy.ts`. Funciona igual; cambiar cuando se decida cortar compatibilidad.
