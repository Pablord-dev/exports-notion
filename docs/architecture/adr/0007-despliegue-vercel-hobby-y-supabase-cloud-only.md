# ADR-0007 — Despliegue en Vercel Hobby con Supabase cloud-only (sin Postgres local)

- **Estado:** Aceptada (2026-07-28)
- **Reemplaza parcialmente:** [ADR-0006](0006-migracion-snapshot-a-postgres-supabase.md) — deja sin efecto su criterio "local-first" (`supabase start` para desarrollo) y resuelve el punto que dejaba abierto: *"en serverless, el pool de conexiones Postgres requiere cuidado (pgBouncer/pooler de Supabase); se decide al retomar el despliegue"*.
- **Fuentes:** despliegue real ejecutado el 2026-07-28 (proyecto Supabase `us-west-2`, Postgres 17.6); verificación de conectividad por pooler contra la instancia real; `docs/to-dos.md` §6.

## Contexto

ADR-0006 migró el snapshot a Postgres y eligió desarrollo **local-first** con Supabase CLI (`supabase start`, Docker), dejando el cloud "para cuando se retome el despliegue". Ese momento llegó: la app se despliega para que colaboradores la usen.

Tres hechos forzaron decisiones:

1. **Dos bases divergen.** Mantener Postgres local para desarrollo y otro en la nube para producción significa dos esquemas que hay que sincronizar a mano, y bugs que sólo aparecen en uno de los dos. El snapshot no es dato de desarrollo: se reconstruye desde Notion en minutos, así que no hay nada que "tener local".
2. **Docker como requisito de desarrollo** era la consecuencia (−) explícita que ADR-0006 aceptó. Sin Postgres local desaparece.
3. **El plan de despliegue es Vercel Hobby** (cap de **60 s** por invocación), y la base ronda **~21k filas**: ~212 requests a Notion a 3 req/s ≈ **71 s sólo de fetches**. Una invocación de full sync no cabe.

## Decisión

1. **Una sola base: Supabase Cloud.** El mismo `DATABASE_URL` en desarrollo local y en Vercel. No hay Postgres local ni `supabase start`. `supabase/` se conserva **sólo** como fuente de migraciones (`supabase link` + `supabase db push`), no como entorno.

2. **Conexión por el transaction pooler (puerto 6543), no la directa (5432).** En serverless cada invocación abre su propia conexión; sin pooler se agota `max_connections`.

3. **`postgres.js` con `prepare: false`.** pgBouncer en modo transaction no soporta prepared statements, que son el default del driver. Sin esta opción los queries fallan en producción aunque funcionen en una conexión directa. Va **siempre**, sin detectar entorno: es inocuo en una conexión directa y así no hay una ruta de código que sólo se ejercite en producción.

4. **Región de las funciones de Vercel igual a la de Supabase** (`pdx1` ↔ `aws us-west-2`). Los reportes hacen varias queries por vista; cruzar el continente en cada round-trip es latencia gratuita que se evita con una opción de configuración.

5. **El full sync no se cronea; sólo el incremental.** Un cron dispara **una** invocación y no encadena. Con `SYNC_BUDGET_MS` cada invocación corta a tiempo y devuelve `done:false` esperando que el cliente vuelva a llamar; el cron nunca lo hace. Peor: el checkpoint (`full:active`, `full:pivot`) tiene TTL de 24 h y el cron corre cada 24 h, así que el avance expiraría justo antes de la siguiente corrida y cada día empezaría de cero. El full se dispara desde la UI, que **sí** encadena (hasta 20 llamadas). El incremental siempre cabe en una invocación, así que conserva su cron.
   - Consecuencia de implementación: `cronSchedule(kind)` devuelve `null` en vez de lanzar. Se evalúa en el top-level de `/api/sync/status`, donde una excepción daba 500 y rompía el modal de sync de la UI.

6. **`SYNC_BUDGET_MS=40000` en Vercel; sin definir en local.** En local no hay cap de invocación, así que el full corre completo de una pasada — que es además la forma recomendada de sembrar la base tras un reset.

7. **El test del SQL real se gatea con `TEST_DATABASE_URL`** y apunta a un **proyecto Supabase dedicado a tests**. Sin Postgres local, `db.pg.test.ts` (única cobertura de `unnest`/upsert, swap transaccional y KV con TTL — ahí se detectó el doble-encoding de jsonb) no tenía dónde correr. Lleva dos guardas, porque una corrida contra la base real borró el snapshot de 21k filas el 2026-07-13: aborta si la URL coincide con `DATABASE_URL`, y aborta si la base destino ya tiene filas en `pages`.

## Consecuencias

- (+) Un solo esquema y una sola base: desaparece la clase de bug "funciona local, falla en prod" por divergencia de datos.
- (+) Docker deja de ser requisito para desarrollar (revierte la consecuencia (−) de ADR-0006).
- (+) El despliegue cabe en el plan gratuito de Vercel.
- (−) **No se puede desarrollar sin internet**, y un `npm run dev` escribe en la **misma base que producción**. No hay red de seguridad: un Full local reconstruye el snapshot que ven los colaboradores. Es el precio directo de la decisión 1.
- (−) El full sync deja de ser desatendido: alguien tiene que apretar el botón. Mitigación: el incremental diario cubre el día a día; el full sólo hace falta ante drift (registros borrados en Notion).
- (−) Correr el test del SQL real exige un segundo proyecto Supabase; sin `TEST_DATABASE_URL` se salta en silencio, así que puede pasar desapercibido que no corre.
- (→) Si el proyecto pasa a Vercel Pro (300 s) o a un host persistente sin cap, revisar las decisiones 5 y 6: el cron del full volvería a ser viable.
