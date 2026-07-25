# Chat de IA sobre BD Tiempos — Diseño (MVP)

**Fecha:** 2026-07-23 · **Rama:** `feat/supabase-reports` · **Modo:** flujo normal

## Objetivo

Un chat dentro de la app que responde preguntas en lenguaje natural sobre el
snapshot de BD Tiempos (horas por persona/subproyecto/proyecto/empresa y en el
tiempo), con **modelos intercambiables**: arranca con **Ollama/Qwen** (local) y
después se enciende **MiniMax** (token) sin recablear nada.

## Principio de diseño

El modelo **no ve las filas** (~21k). Recibe como *herramientas* las funciones de
reporte que ya existen y **decide qué consulta hacer**; el número siempre sale de
Postgres, no del modelo (cero alucinación numérica). Es el patrón de agente con
tool-calling sobre datos estructurados.

Insight que unifica "modelos intercambiables": **Ollama y MiniMax hablan el mismo
dialecto** (OpenAI `/v1/chat/completions` con `tools`). Cambiar de modelo = cambiar
`{ baseUrl, apiKey, model }`. Un solo cliente sirve para ambos.

## Arquitectura

### 1. Capa de proveedor — `src/lib/llm/`

- **`client.ts`** — `chatComplete(providerCfg, messages, tools): Promise<{ content, toolCalls }>`
  vía `fetch` al endpoint OpenAI-compatible, **sin streaming**. Errores de red/HTTP
  se propagan con mensaje claro. Seam `__setLlmClient(fake)` / `__resetLlmClient()`
  para tests (mismo patrón que `__setClient` de notion.ts y `__setStore` de db.ts).
- **`providers.ts` / `config.ts`** — registro leído de env. Un proveedor está
  *disponible* solo si tiene su config completa:

  | Proveedor | Env vars | Notas |
  |---|---|---|
  | `ollama` | `LLM_OLLAMA_BASE_URL` (default `http://localhost:11434/v1`), `LLM_OLLAMA_MODEL` | sin API key |
  | `minimax` | `LLM_MINIMAX_BASE_URL`, `LLM_MINIMAX_API_KEY`, `LLM_MINIMAX_MODEL` | key en header `Authorization: Bearer` |

  `LLM_DEFAULT_PROVIDER` elige el activo inicial (default: primero disponible).
  **No entra al fail-fast de `config.ts`** (sus 7 vars siguen intactas): la config
  LLM es opcional y se lee aparte, así el server arranca solo con Ollama y MiniMax
  se activa al agregar su token.

### 2. Herramientas — `src/lib/llm/tools.ts`

Definiciones de tool (JSON Schema) que envuelven la interfaz `Store`:

| Tool | Envuelve | Args principales |
|---|---|---|
| `totalesPorPersona` | `reportByPerson` | filtros (from/to/people/subprojects/projects/companies) |
| `totalesPorSubproyecto` | `reportBySubproject` | filtros |
| `lineaDeTiempo` | `reportTimeline` | filtros + `granularity: month\|week` |
| `matriz` | `reportMatrix` | filtros + `dim: person\|subproject` |
| `detalle` | `reportDetail` | filtros + `cursor?` + `limit?` |
| `listarFiltros` | `reportFilters` | — (para descubrir nombres/valores válidos) |

Dispatcher `runTool(name, args)`:
- **Valida args reutilizando `parseReportFilters`** de `src/lib/report-params.ts`
  (fechas ISO, from ≤ to, etc.); args inválidos → resultado de error para el modelo,
  no excepción.
- Llama al método del `Store` correspondiente y devuelve el JSON agregado.

### 3. Loop de agente — `src/lib/llm/agent.ts`

`runChat(providerCfg, messages): Promise<{ reply, toolTrace }>`:
- **System prompt** describe la BD (snapshot de tiempos; persona = "Hecho por";
  horas = "Registro de horas"; fechas; dimensiones subproyecto/proyecto/empresa),
  incluye la **fecha de hoy** (inyectada por el caller — no `Date.now()` en libs
  puras si es evitable), e instruye: usar herramientas para **cualquier dato
  numérico**, responder en **español**, y `listarFiltros` antes de filtrar por nombre.
- Bucle **acotado (máx. 5 iteraciones)**: completion con tools → si hay `toolCalls`,
  ejecuta cada uno, adjunta resultados como mensajes `tool`, repite → si no, devuelve
  el texto final. El tope evita loops con un modelo local chico.
- `toolTrace` = lista de `{ name, args, ok }` para transparencia/depuración.

### 4. Endpoints (protegidos por `src/proxy.ts`)

- **`POST /api/chat`** — body `{ messages: ChatMessage[], provider: string }`.
  Valida que el proveedor esté disponible (400 si no), corre `runChat`, responde
  `{ reply, provider, toolTrace }`. 401 vía proxy si no hay sesión.
- **`GET /api/chat/providers`** — `[{ id, label, model }]` disponibles, para el dropdown.
- Agregar `/api/chat` (y subrutas) al matcher de `src/proxy.ts`.

### 5. UI — `src/app/db/tiempos/chat/page.tsx`

- Página cliente dentro de `AppShell`, mismo patrón de auth por 401.
- Al montar: `GET /api/chat/providers` → poblar **dropdown de proveedor** (default =
  el que reporte el server). Si no hay proveedores disponibles, estado vacío con
  instrucción de configurar env.
- Transcript de burbujas (user/assistant), input, botón enviar, **spinner
  "pensando…"** mientras espera (no streaming). Enter envía; Shift+Enter salto.
- Colapsable opcional "consultó: …" que muestra el `toolTrace`.
- Historial vive en el estado del cliente (no se persiste).
- Nueva entrada **"Asistente"** en el sidebar bajo BD Tiempos (`app-shell.tsx`),
  con ícono.

### 6. Tests

- **Unit:**
  - Dispatcher/validación de tools contra `memory-store` (args válidos → llama al
    `Store` correcto; inválidos → error legible).
  - Disponibilidad de proveedores según env presente/ausente y `LLM_DEFAULT_PROVIDER`.
  - Loop de agente con **cliente LLM fake** inyectado (`__setLlmClient`): guiona una
    secuencia tool-call → resultado → respuesta final; verifica que consulta el
    `Store` correcto y compone la respuesta, y que respeta el tope de iteraciones.
- **E2E (smoke ligero):** la página `/db/tiempos/chat` carga, muestra el dropdown y
  el input (con proveedor stub bajo `E2E_STUBS=1`).

## Fuera de alcance (YAGNI)

Streaming · text-to-SQL · persistir historial · identidad por usuario · sincronizar
el chat con los filtros de la página de reportes · RAG/embeddings.

## Orden de entrega

1. **Ollama/Qwen end-to-end** (capas 1-5 + tests). Verificación local del usuario.
2. **Encender MiniMax**: solo config (`LLM_MINIMAX_*`) + validar que su tool-calling
   responde igual. Sin recablear.

## Env vars nuevas (todas opcionales)

```
LLM_DEFAULT_PROVIDER=ollama
LLM_OLLAMA_BASE_URL=http://localhost:11434/v1
LLM_OLLAMA_MODEL=<tag de tu Qwen, p. ej. qwen3.5>
# MiniMax (fase 2)
LLM_MINIMAX_BASE_URL=<base url OpenAI-compatible de MiniMax>
LLM_MINIMAX_API_KEY=<token>
LLM_MINIMAX_MODEL=<modelo>
```
