# Guía de deploy y operación (Vercel Hobby + Supabase Cloud)

Procedimiento real usado el 2026-07-28. Las decisiones detrás de cada paso están en
[ADR-0007](../architecture/adr/0007-despliegue-vercel-hobby-y-supabase-cloud-only.md).

> **No hay Postgres local.** Local y producción usan la **misma** base de Supabase Cloud.
> Un `npm run dev` escribe donde ven los colaboradores — ver *Riesgos* al final.

## 1. Supabase Cloud

Crear el proyecto en [supabase.com](https://supabase.com) y **guardar el password de la DB**
(no se vuelve a mostrar). Elegir la región pensando en la de las funciones de Vercel
(este proyecto usa `us-west-2`).

Aplicar el esquema desde el repo:

```bash
supabase login
supabase link --project-ref <ref>    # el ref está en la URL del dashboard
supabase db push                      # aplica supabase/migrations/
```

No hay datos que migrar: el snapshot se reconstruye desde Notion (paso 4).

### El `DATABASE_URL`

Dashboard → **Connect** → pestaña **Transaction pooler**. Forma:

```
postgresql://postgres.<ref>:<PASSWORD>@aws-1-<region>.pooler.supabase.com:6543/postgres
```

- **Puerto 6543 (pooler), no 5432 (directo).** En serverless cada invocación abre su propia
  conexión; sin pooler se agota `max_connections`.
- Copiarlo del dashboard: el host varía por región.
- `db.ts` pasa `prepare: false` porque pgBouncer en modo transaction no soporta prepared
  statements (el default de `postgres.js`). Sin eso los queries fallan sólo en producción.

## 2. Secretos

```bash
# SESSION_SECRET (iron-session exige ≥32 chars) y CRON_SECRET — uno distinto cada uno
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# APP_PASSWORD_HASH — el password compartido del equipo
node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" "EL-PASSWORD"
```

Generar secretos **nuevos** para producción en vez de reusar los de `.env.local`.

## 3. Vercel

1. Importar el repo. Framework Next.js (autodetecta). **No deployar antes de las env vars:**
   `instrumentation.ts` hace fail-fast y el server no arranca sin las 7 obligatorias.
2. **Settings → Functions → Function Region:** la que corresponda a la región de Supabase
   (`pdx1` para `us-west-2`). El default `iad1` cruzaría el continente en cada query.
3. **Settings → Environment Variables** (Production/Preview/Development):

   | Variable | Valor |
   |---|---|
   | `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `DATE_COLUMN` | los mismos de `.env.local` |
   | `APP_PASSWORD_HASH` | el hash del paso 2 — **literal, sin escapar los `$`** ⚠️ |
   | `SESSION_SECRET`, `CRON_SECRET` | los del paso 2 |
   | `DATABASE_URL` | el pooler del paso 1 |
   | `SYNC_BUDGET_MS` | `40000` |
   | `LLM_MINIMAX_BASE_URL`, `LLM_MINIMAX_API_KEY`, `LLM_MINIMAX_MODEL` | los de `.env.local` |
   | `LLM_DEFAULT_PROVIDER` | `minimax` |

   - `APP_PASSWORD_HASH` va **con `\$` escapados en `.env.local`** pero **literal en Vercel**.
     Es la inversión más fácil de equivocar.
   - **No** cargar `LLM_OLLAMA_*`: apuntan a un `localhost` que no existe en serverless.
     MiniMax necesita sus **tres** vars o el proveedor no se registra y el chat dice "sin modelo".
4. Deployar. La rama de producción es `main`; los crons **sólo corren en deploys de producción**.

`vercel.json` declara **sólo el cron incremental** — el full no se cronea (ADR-0007 §5).

## 4. Primer Full sync

`/api/export` responde **503 `no_data`** hasta que exista snapshot.

**Recomendado — sembrar desde local** (sin cap de 60 s, `SYNC_BUDGET_MS` no está en `.env.local`):
`npm run dev` → login → Reportes → modal Sync → **Full**. Las ~21k filas entran en una sola
pasada (~2 min, limitado por el throttle de 3 req/s de Notion).

**Desde Vercel:** login → **Full** y **dejar la pestaña abierta** ~3 min. La UI encadena tramos
de 40 s hasta 20 veces; si se cierra la pestaña el encadenado se corta (el avance queda
checkpointeado y reanuda al volver a apretar Full).

## 5. Operación

- **Incremental:** automático, diario 21:00 UTC (15:00 CDMX).
- **Full:** manual, cuando se sospeche drift (registros borrados en Notion que no se reflejan).
- **Progreso del sync:** la UI muestra el número de registros procesados **sin denominador** —
  Notion no expone un total de antemano. Al terminar, "último sync" da el total real.
- **Sync trancado:** `node scripts/reset-sync-state.cjs` (no toca el snapshot vivo).
- **Detectar drift:** `node scripts/check-cache-drift.cjs [sinceISO]` (sólo lectura).
- **Colaboradores:** todos comparten un password; no hay usuarios individuales. El rate limit
  es 5 intentos/15 min **por IP** — en una misma red de oficina comparten el contador. Los chats
  del Asistente viven en el `localStorage` de cada navegador: no se comparten.

## Riesgos a tener presentes

- **Local y producción son la misma base.** Un Full desde `npm run dev` reconstruye el snapshot
  que ven los colaboradores. No hay entorno de pruebas de datos.
- **Sin internet no se puede desarrollar.**
- **El test del SQL real** (`db.pg.test.ts`) exige `TEST_DATABASE_URL` apuntando a un **segundo
  proyecto Supabase**: dropea y trunca tablas. Sin la variable se salta en silencio. Una corrida
  contra la base real borró el snapshot de 21k filas el 2026-07-13; por eso hay dos guardas.
- **Vercel Hobby** es, por términos de servicio, para uso personal/no comercial.
