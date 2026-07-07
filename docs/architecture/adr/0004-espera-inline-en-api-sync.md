# ADR-0004 — `POST /api/sync` espera inline (sin "void background")

- **Estado:** Aceptada
- **Fecha:** 2026-06-05 (commit `2fb6f50`; el problema se diagnosticó en el acta del 2026-05-18 §13)
- **Fuentes:** acta `202605181515_session_changes.md` §13; acta `202606051159_session_changes.md` §2

## Contexto

El diseño original respondía `202 Accepted` y lanzaba `void runSync(kind)` en background. En Vercel serverless **la función muere al responder**: el `runSync` huérfano a veces no completaba y dejaba `status=running` colgado sin proceso vivo (la UI quedaba bloqueada hasta que el TTL del lock, 600s, liberaba el estado). Incidente observado en producción tras el primer deploy.

## Decisión

`POST /api/sync` **awaitea el sync completo** y responde al final con el resultado:

- `{ok:true, done:true, upserted, deleted}` — sync terminado.
- `{ok:true, done:false, segmentCount}` — full con presupuesto agotado: el **cliente** debe volver a llamar para continuar (la UI encadena; el cron no).
- `409` si otro sync tiene el lock.

Este contrato `{ok, done}` es estable: la UI (`page.tsx`) itera POSTs hasta `done:true`.

## Consecuencias

- (+) Nunca hay trabajo huérfano: si la respuesta llegó, el estado en Redis es consistente con ella.
- (+) El mismo contrato sirve para cron (una invocación) y para la UI (encadenamiento).
- (−) La invocación puede ser larga (minutos en un full completo); exige `maxDuration` amplio en plataformas serverless (300s declarados, sólo Vercel Pro los honra).
- (−) El cliente debe tolerar respuestas lentas y reintentos (`done:false`).
