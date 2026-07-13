# ExportNotion

Webapp interna para descargar contenido de una base de Notion como CSV, con filtro de rango de fechas y autenticación por password compartido.

## Stack

Next.js 16 (App Router, TS) · React 19 · Tailwind v4 · Postgres/Supabase (`postgres.js`) · `@notionhq/client` v5 · iron-session v8 · Vitest 4 · Playwright

## Setup local

1. Copia `.env.example` a `.env.local` y rellena las variables.
2. Genera el hash bcrypt del password compartido:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "MI-PASSWORD"
   ```
3. Edita `src/lib/columns.ts` con la whitelist real de propiedades de tu base.
4. Ajusta `DATE_COLUMN` al nombre exacto de la propiedad fecha (debe estar también en la whitelist).
5. **`NOTION_DATABASE_ID`:** desde el SDK v5 esta variable debe contener un **Data Source ID**, no el ID antiguo de database. Para obtenerlo: abre tu base de Notion como página, copia su `database_id`, luego `GET https://api.notion.com/v1/databases/<id>` con tu integration token y usa `data_sources[0].id`.
6. Levanta el Postgres local (requiere Docker Desktop corriendo) y aplica el esquema:
   ```bash
   supabase start        # DB en postgresql://postgres:postgres@127.0.0.1:54322/postgres (tu DATABASE_URL local)
   ```
7. Levanta dev:
   ```bash
   npm install
   npm run dev
   ```

## Tests

```bash
npm test                # unit + integration (Vitest)
npm run test:e2e        # Playwright smoke — corre con stubs en memoria, sin Postgres/Notion reales
E2E_REAL=1 npm run test:e2e   # modo original: contra el server real del puerto 3000 (.env.local)
PG_TEST=1 npx vitest run tests/integration/db.pg.test.ts   # SQL real de db.ts contra el Postgres local
```

> Por defecto el E2E levanta su propio server (`next build` + `next start`, puerto 3100) con `E2E_STUBS=1`: store de datos y rate-limit en memoria y password fijo `e2e-password`. No choca con un dev server abierto ni gasta el rate limit real.

## Deploy a Vercel

1. Conecta el repo a Vercel.
2. Configura **todas** las env vars del `.env.example` en Project Settings (`DATABASE_URL` debe apuntar al Postgres de Supabase cloud; en serverless usar el **transaction pooler** de Supabase).
3. Push a `main` → Vercel deploya y activa los crons del `vercel.json`.
4. **Primer sync:** después del primer deploy, entra a la app, haz login y aprieta "Full". Sin ese primer sync el `/api/export` responde 503.

## Operación

- **Cron incremental**: diario 21:00 UTC (15:00 CDMX) — `0 21 * * *`. En Vercel Hobby cada expresión cron solo permite una corrida diaria.
- **Cron full**: diario 09:00 UTC (03:00 CDMX) — `0 9 * * *`.
- **Botón "Full"**: usa cuando sospeches drift (borrados no detectados).
- **Estado y errores de sync**: visibles en la UI (último sync, próximo cron, progreso, último error).

## Seguridad

- Password compartido (bcrypt) + cookie `httpOnly` firmada (iron-session).
- Rate limit 5 intentos / 15 min por IP (ventana fija en Postgres, tabla `login_attempts`).
- Whitelist server-side (`src/lib/columns.ts`): el cliente nunca puede pedir columnas fuera de la lista.
- Cron auth: header `Authorization: Bearer <CRON_SECRET>`.

## Notas técnicas

- **Límites de Vercel**: `maxDuration` declarado es 60s (export) y 300s (sync), pero **los 300s solo aplican con plan Pro — en Hobby toda función se capa a 60s**. El sync incremental siempre cabe; una invocación del full puede morir a mitad, pero desde el fix FX-004 (2026-07-06) **no pierde avance**: checkpoint por batch + flag de sesión hacen que el siguiente intento reanude. Para cortes limpios definir `SYNC_BUDGET_MS` — ver CLAUDE.md §Límites de plataforma.
- **Empty data source en primer sync**: `runFull` ya maneja correctamente el caso de 0 páginas (no borra el cache previo, sólo actualiza `lastFullAt`).
- **Convención Next 16**: la protección de rutas vive en `src/proxy.ts` (ex-`middleware.ts`, renombrado 2026-07-06; el warning de deprecación desapareció). Además `src/instrumentation.ts` valida las 8 env vars al arrancar el server (fail-fast): con vars faltantes el server no levanta y lista cuáles faltan.

## Documentación

Índice completo en [docs/00-index.md](docs/00-index.md). Atajos:

- [Manual de usuario](docs/guides/manual-usuario.md) — con screenshots (login, sync, descarga).
- [CLAUDE.md](CLAUDE.md) — arquitectura, esquema de Postgres, límites de plataforma.
- [scripts/](scripts/) — herramientas operativas (destrabar sync, detectar drift del cache).
