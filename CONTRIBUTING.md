# Contribuir a ExportNotion

Guía mínima. El setup local está en [README.md](README.md); la arquitectura, claves de Redis y límites de plataforma en [CLAUDE.md](CLAUDE.md); las decisiones de fondo en [docs/architecture/adr/](docs/architecture/adr/).

## Commits

Conventional commits en español, imperativo, con scope cuando aporta:

```
tipo(scope): resumen en una línea

Cuerpo opcional: el porqué y lo no obvio (hallazgos verificados, trade-offs).
```

- Tipos en uso: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
- Scopes en uso: `sync`, `ui`, `e2e`, `lint`, `robustez`, `brief`, `archive`.
- Un commit = un cambio coherente. Trabajo mezclado (p. ej. fix + reorganización de docs) se separa en commits distintos.
- No commitear en `main` directo: rama por tema (`fix/...`, `feat/...`).

## Verificación requerida antes de commitear

```bash
npm test           # 100% verde — Vitest (unit + integration)
npx tsc --noEmit   # typecheck limpio
npm run lint       # eslint limpio
npm run test:e2e   # si tocaste rutas, auth o UI (corre con stubs, sin Upstash real)
```

## Reglas del proyecto

- **Fakes fieles**: los tests usan `__setClient(fake)` (exportado por `notion.ts` y `cache.ts`) con los fakes de `tests/fixtures/`. Si cambias el comportamiento frente a la API real, **actualiza el fake para que siga siendo fiel** — un fake infiel ya ocultó un bug real en producción (ver D1/FX-005 en `docs/reports/202606101520_incident_report_sync_incremental.md`).
- **Verifica contra la API real antes de asumir**: los tipos del SDK de Notion declaran parámetros que el servidor rechaza (ver ADR-0002 y el addendum del incident report). Una query de solo lectura vale más que la documentación.
- **Env vars**: las 8 son obligatorias (fail-fast al boot). No introduzcas defaults silenciosos.
- **Documentación**: los docs viven en `docs/` con índice en `docs/00-index.md` — actualízalo al agregar documentos. Entregables fechados llevan prefijo `AAAAMMDDHHMM_`; los de nombre estable (README, ADRs, guías) no. Los pendientes se registran en `docs/to-dos.md`.
- Path alias `@/*` → `src/*`.
