# ADR-0005 — Presupuesto de tiempo del full: de obligatorio a opcional (`SYNC_BUDGET_MS`)

- **Estado:** Aceptada (la reversión de 2026-06-05, matizada por FX-004 el 2026-07-06)
- **Fuentes:** acta `202606051159_session_changes.md` §2 y "Riesgo conocido"; incident report `202606101520` (FX-004); CLAUDE.md §Límites de plataforma

## Contexto

Para sobrevivir el `maxDuration=60s` de Vercel Hobby, el full sync llegó a tener un presupuesto de tiempo **obligatorio** por segmento (`timeBudgetMs`, default 25s) más un session flag. Al decidirse que el destino del despliegue es **local / por definir** (criterio local-first, 2026-06-05), esas restricciones de diseño dejaron de justificar su complejidad y se revirtieron (restauración al estado del commit `2fb6f50` + `maxDuration` 300).

La reversión reintrodujo un riesgo documentado: sin presupuesto ni session flag, una función muerta a mitad de full podía borrar el `:new` acumulado al reintentarse (eso exactamente causó la caída del cache de 18k → 2k filas en producción, acta 2026-05-18 §13.1). El incident report `202606101520` lo formalizó como defecto D3.

## Decisión

Dos piezas complementarias (fix FX-004, 2026-07-06):

1. **Reanudación siempre activa** (sin costo para local): upsert progresivo por batch al `:new`, checkpoint de pivote por batch y flag de sesión `notion:sync:full:active`. Una función muerta a mitad ya no pierde avance ni borra el `:new`; el siguiente intento reanuda.
2. **Presupuesto opcional** via env var `SYNC_BUDGET_MS`: sin definir (local / Vercel Pro), la invocación corre hasta terminar; definido (p. ej. 40000 en plataformas con timeout corto), cada invocación corta a tiempo con checkpoint y responde `done:false` para que el cliente encadene.

## Consecuencias

- (+) Local-first sin complejidad de plataforma: en local no hay presupuesto y el full corre de una pasada.
- (+) El soporte para plataformas con timeout corto queda listo: activar una env var, sin cambios de código.
- (+) La muerte súbita de la función (cualquier causa) ya no pierde datos — propiedad que la reversión de 2026-06-05 había sacrificado.
- (−) Más claves de estado en Redis (`notion:sync:full:pivot`, `notion:sync:full:active`) y una máquina de estados de sesión que hay que respetar al operar (ver `scripts/reset-sync-state.cjs`).
