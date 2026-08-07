# ExportNotion

Webapp interna para descargar contenido de una base de Notion como CSV, con filtro de rango de fechas y login con Google (dominios en allowlist).

## Stack

Next.js 16 (App Router, TS) · React 19 · Tailwind v4 · Postgres/Supabase (`postgres.js`) · `@notionhq/client` v5 · iron-session v8 · Vitest 4 · Playwright

## Setup local

> **No hay Postgres local** (ADR-0007): local y producción usan la **misma** base de Supabase
> Cloud. No hace falta Docker, pero sí internet — y un Full desde local reconstruye el snapshot
> que ven los colaboradores.

1. Copia `.env.example` a `.env.local` y rellena las variables.
2. `DATABASE_URL` = el **transaction pooler** de tu proyecto Supabase (puerto **6543**, no 5432).
   Dashboard → Connect → Transaction pooler. Ver [guía de deploy](docs/guides/deploy.md).
3. Configura Google Cloud (manual, una vez):
   1. Google Cloud Console → tu proyecto → **Google Auth Platform**: *Audience* con User type
      **External**, y **publicar** la app (en *Testing* hay cap de 100 usuarios). Scopes: sólo
      `openid`, `email`, `profile`.
   2. *Credentials* → **Create credentials** → **OAuth client ID** → tipo **Web application**.
   3. *Authorized redirect URIs*, exactos: `http://localhost:3000/api/auth/google/callback`.
   4. Copia el Client ID y el secret a `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
4. Edita `src/lib/columns.ts` con la whitelist real de propiedades de tu base.
5. Ajusta `DATE_COLUMN` al nombre exacto de la propiedad fecha (debe estar también en la whitelist).
6. **`NOTION_DATABASE_ID`:** desde el SDK v5 esta variable debe contener un **Data Source ID**, no el ID antiguo de database. Para obtenerlo: abre tu base de Notion como página, copia su `database_id`, luego `GET https://api.notion.com/v1/databases/<id>` con tu integration token y usa `data_sources[0].id`.
7. Aplica el esquema a la base (sólo la primera vez o al agregar migraciones):
   ```bash
   supabase login && supabase link --project-ref <ref>
   supabase db push
   ```
8. Levanta dev:
   ```bash
   npm install
   npm run dev
   ```

## Tests

```bash
npm test                # unit + integration (Vitest)
npm run test:e2e        # Playwright smoke — corre con stubs en memoria, sin Postgres/Notion reales
E2E_REAL=1 npm run test:e2e   # modo original: contra el server real del puerto 3000 (.env.local)

# SQL real de db.ts. Requiere un PROYECTO SUPABASE DEDICADO A TESTS: dropea y trunca tablas.
TEST_DATABASE_URL="postgresql://…:6543/postgres" npx vitest run tests/integration/db.pg.test.ts
```

> Sin `TEST_DATABASE_URL` el test del SQL real **se salta en silencio**. Nunca apuntarlo a la base
> del app: una corrida contra la base real borró el snapshot de 21k filas (2026-07-13). El test
> aborta si la URL coincide con `DATABASE_URL` o si la base destino ya tiene filas en `pages`.

> Por defecto el E2E levanta su propio server (`next build` + `next start`, puerto 3100) con `E2E_STUBS=1`: store de datos y rate-limit en memoria, y la sesión entra por `GET /api/auth/stub-login` (sólo existe con la bandera). No choca con un dev server abierto ni gasta el rate limit real.

## Deploy a Vercel

Procedimiento completo en **[docs/guides/deploy.md](docs/guides/deploy.md)**. Resumen:

1. Conecta el repo a Vercel (rama de producción `main`; los crons **sólo** corren en producción).
2. **Function Region** = la región de tu Supabase (`pdx1` para `us-west-2`).
3. Configura las env vars del `.env.example` en Project Settings. `DATABASE_URL` = **transaction
   pooler** (6543). `SYNC_BUDGET_MS=40000` (cap de 60s en Hobby). `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS` y `APP_ORIGIN` (este último con el dominio de
   producción, no `localhost`). No cargues `LLM_OLLAMA_*` (localhost no existe en serverless).
4. Push a `main` → deploya y activa el cron incremental del `vercel.json`.
5. **Primer sync:** login y "Full" (mejor desde local, sin cap de 60s). Sin snapshot, `/api/export`
   responde 503.

## Operación

- **Cron incremental**: diario 21:00 UTC (15:00 CDMX) — `0 21 * * *`. En Vercel Hobby cada expresión cron solo permite una corrida diaria.
- **El full NO se cronea** (ADR-0007): un cron dispara una sola invocación y no encadena los tramos
  de `SYNC_BUDGET_MS`, y el checkpoint (TTL 24h) expiraría antes del cron siguiente. Se dispara con
  el **botón "Full"**, que sí encadena — úsalo cuando sospeches drift (borrados no detectados).
- **Estado y errores de sync**: visibles en la UI (último sync, próximo cron, progreso, último error).
  El progreso se muestra **sin denominador**: Notion no expone un total de antemano.

## Seguridad

- Login con Google (OAuth 2.0 + PKCE, dominios en allowlist) + cookie `httpOnly` firmada (iron-session).
- Rate limit 5 intentos / 15 min por IP sobre el callback de OAuth (ventana fija en Postgres, tabla `login_attempts`).
- Whitelist server-side (`src/lib/columns.ts`): el cliente nunca puede pedir columnas fuera de la lista.
- Cron auth: header `Authorization: Bearer <CRON_SECRET>`.

## Notas técnicas

- **Límites de Vercel**: `maxDuration` declarado es 60s (export) y 300s (sync), pero **los 300s solo aplican con plan Pro — en Hobby toda función se capa a 60s**. El sync incremental siempre cabe; una invocación del full puede morir a mitad, pero desde el fix FX-004 (2026-07-06) **no pierde avance**: checkpoint por batch + flag de sesión hacen que el siguiente intento reanude. Para cortes limpios definir `SYNC_BUDGET_MS` — ver CLAUDE.md §Límites de plataforma.
- **Postgres en serverless**: `db.ts` conecta con `prepare: false`. El transaction pooler de Supabase (pgBouncer) no soporta prepared statements, que son el default de `postgres.js`; sin esa opción los queries fallan **sólo en producción**.
- **Contadores del full encadenado (FX-006)**: `processed`/`skipped` son de la **sesión**, no de la invocación — al reanudar se siembran desde el status persistido, o el progreso se reiniciaría en cada tramo. El total final que se reporta es el conteo real de filas del staging, no un acumulado por invocación.
- **Empty data source en primer sync**: `runFull` ya maneja correctamente el caso de 0 páginas (no borra el cache previo, sólo actualiza `lastFullAt`).
- **Convención Next 16**: la protección de rutas vive en `src/proxy.ts` (ex-`middleware.ts`, renombrado 2026-07-06; el warning de deprecación desapareció). Además `src/instrumentation.ts` valida las 10 env vars obligatorias al arrancar el server (fail-fast): con vars faltantes el server no levanta y lista cuáles faltan.

## Documentación

Índice completo en [docs/00-index.md](docs/00-index.md). Atajos:

- [Manual de usuario](docs/guides/manual-usuario.md) — con screenshots (login, sync, descarga).
- [Guía de deploy](docs/guides/deploy.md) — Vercel Hobby + Supabase Cloud, paso a paso y riesgos.
- [CLAUDE.md](CLAUDE.md) — arquitectura, esquema de Postgres, límites de plataforma.
- [scripts/](scripts/) — herramientas operativas (destrabar sync, detectar drift del cache).
