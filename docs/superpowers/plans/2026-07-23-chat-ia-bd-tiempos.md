# Chat de IA sobre BD Tiempos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un chat autenticado que responde preguntas en lenguaje natural sobre el snapshot de BD Tiempos usando tool-calling sobre las funciones de reporte existentes, con modelos intercambiables (Ollama/Qwen primero, MiniMax después).

**Architecture:** Cliente único OpenAI-compatible (`/v1/chat/completions`, sin streaming) parametrizado por proveedor; las 6 funciones del `Store` se exponen como herramientas y el número siempre sale de Postgres; un loop de agente acotado orquesta las tool-calls; endpoint `POST /api/chat` + `GET /api/chat/providers` detrás del proxy; página cliente `/db/tiempos/chat` con dropdown de proveedor.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `fetch` nativo, Vitest (unit) + Playwright (E2E), Tailwind. Sin SDKs de LLM (ambos proveedores hablan OpenAI-compatible).

## Global Constraints

- **Sin commits en esta sesión** (instrucción vigente del usuario): cada "Verificar" corre los tests/checks indicados y deja el árbol listo, **sin `git commit`**. Los archivos quedan en el repo sin versionar.
- **No tocar el fail-fast de `config.ts`**: las env vars LLM son **opcionales** y se leen con `process.env.*` directo, nunca en `loadConfig()`. El server debe arrancar con solo Ollama configurado (o sin nada).
- **Idioma:** todo texto visible y el system prompt en **español** (con acentos correctos).
- **Patrón de seams para tests:** `__setLlmClient(fake)` / `__resetLlmClient()` en `client.ts` (igual que `__setClient` de notion.ts y `__setStore` de db.ts). Nunca mocks globales de `fetch`.
- **Path alias:** `@/*` → `src/*`.
- **Números:** cualquier dato numérico proviene de las funciones del `Store` vía tool-calling; el modelo no inventa cifras.
- **Comandos de verificación:** `npx tsc --noEmit`, `npm run lint`, `npm test`, y para E2E `npm run test:e2e`.

## File Structure

- `src/lib/llm/types.ts` — tipos compartidos (mensajes, tool defs, provider config).
- `src/lib/llm/client.ts` — request/response OpenAI-compatible + seam de tests.
- `src/lib/llm/providers.ts` — registro de proveedores desde env.
- `src/lib/llm/tools.ts` — definiciones de tools + dispatcher `runTool`.
- `src/lib/llm/agent.ts` — loop `runChat` + system prompt.
- `src/lib/llm/request.ts` — validación del body del endpoint.
- `src/app/api/chat/route.ts` — `POST` del chat.
- `src/app/api/chat/providers/route.ts` — `GET` de proveedores.
- `src/proxy.ts` — agregar `/api/chat` al matcher (modificar).
- `src/app/db/tiempos/chat/page.tsx` — UI del chat.
- `src/app/components/app-shell.tsx` — entrada "Asistente IA" en el sidebar (modificar).
- `tests/unit/llm-client.test.ts`, `llm-providers.test.ts`, `llm-tools.test.ts`, `llm-agent.test.ts`, `llm-request.test.ts`.
- `tests/e2e/smoke.spec.ts` — smoke de la página de chat (modificar).

---

### Task 1: Tipos + cliente OpenAI-compatible

**Files:**
- Create: `src/lib/llm/types.ts`
- Create: `src/lib/llm/client.ts`
- Test: `tests/unit/llm-client.test.ts`

**Interfaces:**
- Produces: `ChatMessage`, `ToolCall`, `ToolDef`, `ProviderConfig`, `ChatResult` (types); `buildRequestBody(provider, messages, tools)`, `parseResponse(json): ChatResult`, `chatComplete: LlmClient`, `__setLlmClient(fake)`, `__resetLlmClient()`.

- [ ] **Step 1: Crear los tipos**

`src/lib/llm/types.ts`:
```ts
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** Argumentos como string JSON (formato OpenAI). */
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Solo en role "assistant" cuando el modelo pide herramientas. */
  tool_calls?: ToolCall[];
  /** Solo en role "tool": id del tool_call que responde. */
  tool_call_id?: string;
  /** Nombre de la herramienta (role "tool"). */
  name?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema de los parámetros. */
  parameters: Record<string, unknown>;
}

export interface ProviderConfig {
  id: string;
  label: string;
  /** Termina en /v1 (endpoint OpenAI-compatible). */
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
}

export type LlmClient = (
  provider: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDef[],
) => Promise<ChatResult>;
```

- [ ] **Step 2: Escribir el test que falla**

`tests/unit/llm-client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildRequestBody, parseResponse } from "@/lib/llm/client";
import type { ProviderConfig } from "@/lib/llm/types";

const provider: ProviderConfig = { id: "ollama", label: "x", baseUrl: "http://x/v1", model: "qwen" };

describe("llm client", () => {
  it("buildRequestBody mapea assistant.tool_calls y role tool al formato OpenAI", () => {
    const body = buildRequestBody(
      provider,
      [
        { role: "user", content: "hola" },
        { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "listarFiltros", arguments: "{}" }] },
        { role: "tool", tool_call_id: "c1", name: "listarFiltros", content: '{"people":[]}' },
      ],
      [{ name: "listarFiltros", description: "d", parameters: { type: "object", properties: {} } }],
    );
    expect(body.model).toBe("qwen");
    expect(body.stream).toBe(false);
    expect(body.tools?.[0]).toEqual({ type: "function", function: { name: "listarFiltros", description: "d", parameters: { type: "object", properties: {} } } });
    expect(body.messages[1]).toEqual({ role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "listarFiltros", arguments: "{}" } }] });
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"people":[]}' });
  });

  it("buildRequestBody omite tools cuando la lista viene vacía", () => {
    const body = buildRequestBody(provider, [{ role: "user", content: "hola" }], []);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("parseResponse extrae contenido y tool calls", () => {
    const r = parseResponse({ choices: [{ message: { content: "hola", tool_calls: [{ id: "c1", type: "function", function: { name: "matriz", arguments: '{"dim":"person"}' } }] } }] });
    expect(r.content).toBe("hola");
    expect(r.toolCalls).toEqual([{ id: "c1", name: "matriz", arguments: '{"dim":"person"}' }]);
  });

  it("parseResponse tolera respuesta sin tool_calls ni content", () => {
    expect(parseResponse({ choices: [{ message: {} }] })).toEqual({ content: "", toolCalls: [] });
  });
});
```

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `npx vitest run tests/unit/llm-client.test.ts`
Expected: FAIL con "does not provide an export named 'buildRequestBody'".

- [ ] **Step 4: Implementar el cliente**

`src/lib/llm/client.ts`:
```ts
import type { ChatMessage, ChatResult, LlmClient, ProviderConfig, ToolDef } from "./types";

interface OpenAiRequestBody {
  model: string;
  messages: unknown[];
  tools?: { type: "function"; function: ToolDef }[];
  tool_choice?: "auto";
  stream: false;
  temperature: number;
}

function toWireMessage(m: ChatMessage): unknown {
  if (m.role === "assistant" && m.tool_calls?.length) {
    return {
      role: "assistant",
      content: m.content ?? "",
      tool_calls: m.tool_calls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })),
    };
  }
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
  }
  return { role: m.role, content: m.content };
}

export function buildRequestBody(provider: ProviderConfig, messages: ChatMessage[], tools: ToolDef[]): OpenAiRequestBody {
  return {
    model: provider.model,
    messages: messages.map(toWireMessage),
    tools: tools.length ? tools.map((t) => ({ type: "function", function: t })) : undefined,
    tool_choice: tools.length ? "auto" : undefined,
    stream: false,
    temperature: 0,
  };
}

export function parseResponse(json: unknown): ChatResult {
  const msg = ((json as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message) ?? {};
  const rawCalls = (msg.tool_calls as { id: string; function?: { name: string; arguments?: string } }[]) ?? [];
  return {
    content: typeof msg.content === "string" ? msg.content : "",
    toolCalls: rawCalls.map((tc) => ({ id: tc.id, name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "{}" })),
  };
}

const realClient: LlmClient = async (provider, messages, tools) => {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(buildRequestBody(provider, messages, tools)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${provider.id} HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return parseResponse(await res.json());
};

let client: LlmClient = realClient;
export const chatComplete: LlmClient = (p, m, t) => client(p, m, t);
export function __setLlmClient(fake: LlmClient): void { client = fake; }
export function __resetLlmClient(): void { client = realClient; }
```

- [ ] **Step 5: Correr el test para verlo pasar**

Run: `npx vitest run tests/unit/llm-client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verificar (sin commit)**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 2: Registro de proveedores desde env

**Files:**
- Create: `src/lib/llm/providers.ts`
- Test: `tests/unit/llm-providers.test.ts`

**Interfaces:**
- Consumes: `ProviderConfig` (Task 1).
- Produces: `availableProviders(): ProviderConfig[]`, `resolveProvider(id: string | undefined): ProviderConfig | null`.

- [ ] **Step 1: Escribir el test que falla**

`tests/unit/llm-providers.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { availableProviders, resolveProvider } from "@/lib/llm/providers";

const ENV = ["LLM_OLLAMA_MODEL", "LLM_OLLAMA_BASE_URL", "LLM_MINIMAX_MODEL", "LLM_MINIMAX_API_KEY", "LLM_MINIMAX_BASE_URL", "LLM_DEFAULT_PROVIDER"];
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = {}; for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("llm providers", () => {
  it("sin env no hay proveedores", () => {
    expect(availableProviders()).toEqual([]);
    expect(resolveProvider(undefined)).toBeNull();
    expect(resolveProvider("ollama")).toBeNull();
  });

  it("ollama disponible con solo el modelo (base url default)", () => {
    process.env.LLM_OLLAMA_MODEL = "qwen3.5";
    const ps = availableProviders();
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ id: "ollama", baseUrl: "http://localhost:11434/v1", model: "qwen3.5" });
    expect(ps[0].apiKey).toBeUndefined();
  });

  it("minimax requiere modelo + key + base", () => {
    process.env.LLM_MINIMAX_MODEL = "m";
    expect(availableProviders().find((p) => p.id === "minimax")).toBeUndefined();
    process.env.LLM_MINIMAX_API_KEY = "k";
    process.env.LLM_MINIMAX_BASE_URL = "http://mm/v1";
    expect(availableProviders().find((p) => p.id === "minimax")).toMatchObject({ id: "minimax", apiKey: "k", baseUrl: "http://mm/v1", model: "m" });
  });

  it("resolveProvider respeta LLM_DEFAULT_PROVIDER y cae al primero disponible", () => {
    process.env.LLM_OLLAMA_MODEL = "q";
    process.env.LLM_MINIMAX_MODEL = "m";
    process.env.LLM_MINIMAX_API_KEY = "k";
    process.env.LLM_MINIMAX_BASE_URL = "http://mm/v1";
    process.env.LLM_DEFAULT_PROVIDER = "minimax";
    expect(resolveProvider(undefined)?.id).toBe("minimax");
    expect(resolveProvider("ollama")?.id).toBe("ollama");
    expect(resolveProvider("nope")).toBeNull();
    delete process.env.LLM_DEFAULT_PROVIDER;
    expect(resolveProvider(undefined)?.id).toBe("ollama");
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run tests/unit/llm-providers.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar el registro**

`src/lib/llm/providers.ts`:
```ts
import type { ProviderConfig } from "./types";

export function availableProviders(): ProviderConfig[] {
  const out: ProviderConfig[] = [];

  const ollamaModel = process.env.LLM_OLLAMA_MODEL;
  if (ollamaModel) {
    out.push({
      id: "ollama",
      label: `Qwen local (${ollamaModel})`,
      baseUrl: process.env.LLM_OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      model: ollamaModel,
    });
  }

  const mmModel = process.env.LLM_MINIMAX_MODEL;
  const mmKey = process.env.LLM_MINIMAX_API_KEY;
  const mmBase = process.env.LLM_MINIMAX_BASE_URL;
  if (mmModel && mmKey && mmBase) {
    out.push({ id: "minimax", label: `MiniMax (${mmModel})`, baseUrl: mmBase, apiKey: mmKey, model: mmModel });
  }

  return out;
}

export function resolveProvider(id: string | undefined): ProviderConfig | null {
  const all = availableProviders();
  if (!all.length) return null;
  if (id) return all.find((p) => p.id === id) ?? null;
  const def = process.env.LLM_DEFAULT_PROVIDER;
  return (def ? all.find((p) => p.id === def) : undefined) ?? all[0];
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run tests/unit/llm-providers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verificar (sin commit)**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 3: Herramientas (defs + dispatcher)

**Files:**
- Create: `src/lib/llm/tools.ts`
- Test: `tests/unit/llm-tools.test.ts`

**Interfaces:**
- Consumes: `ToolDef` (Task 1); `reportByPerson`, `reportBySubproject`, `reportTimeline`, `reportMatrix`, `reportDetail`, `reportFilters` de `@/lib/db`; `parseReportFilters` de `@/lib/report-params`.
- Produces: `TOOL_DEFS: ToolDef[]`, `runTool(name: string, rawArgs: string): Promise<unknown>`.

- [ ] **Step 1: Escribir el test que falla**

`tests/unit/llm-tools.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";
import { runTool, TOOL_DEFS } from "@/lib/llm/tools";
import { REPORT_SEED } from "../fixtures/reportCases";

beforeEach(async () => {
  db.__setStore(newMemoryStore());
  await db.upsertRows(REPORT_SEED);
});

describe("llm tools", () => {
  it("expone 6 herramientas con schema de objeto", () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual(
      ["detalle", "lineaDeTiempo", "listarFiltros", "matriz", "totalesPorPersona", "totalesPorSubproyecto"],
    );
    for (const t of TOOL_DEFS) expect(t.parameters).toMatchObject({ type: "object" });
  });

  it("totalesPorPersona corre el reporte con filtros", async () => {
    const r = await runTool("totalesPorPersona", JSON.stringify({ from: "2026-06-01", to: "2026-06-30" }));
    expect(r).toEqual([
      { person: "u-beto", label: "Beto", hours: 4, count: 2 },
      { person: "u-ana", label: "Ana", hours: 3.5, count: 2 },
    ]);
  });

  it("lineaDeTiempo respeta la granularidad", async () => {
    const r = await runTool("lineaDeTiempo", JSON.stringify({ from: "2026-06-01", to: "2026-06-30", granularity: "week" }));
    expect(r).toEqual([
      { bucket: "2026-06-01", hours: 4.5, count: 3 },
      { bucket: "2026-06-08", hours: 3, count: 1 },
    ]);
  });

  it("matriz valida dim", async () => {
    expect(await runTool("matriz", JSON.stringify({ dim: "bad" }))).toMatchObject({ error: expect.stringContaining("dim") });
  });

  it("fechas malformadas → error legible, no excepción", async () => {
    expect(await runTool("totalesPorPersona", JSON.stringify({ from: "ayer" }))).toMatchObject({ error: "bad_from" });
  });

  it("args no-JSON → error", async () => {
    expect(await runTool("totalesPorPersona", "{no json")).toMatchObject({ error: expect.any(String) });
  });

  it("herramienta desconocida → error", async () => {
    expect(await runTool("inexistente", "{}")).toMatchObject({ error: expect.stringContaining("desconocida") });
  });

  it("listarFiltros devuelve el catálogo", async () => {
    const r = (await runTool("listarFiltros", "{}")) as { people: unknown[]; subprojects: string[] };
    expect(r.subprojects).toContain("Alpha");
    expect(Array.isArray(r.people)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run tests/unit/llm-tools.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar tools + dispatcher**

`src/lib/llm/tools.ts`:
```ts
import { reportByPerson, reportBySubproject, reportTimeline, reportMatrix, reportDetail, reportFilters } from "@/lib/db";
import { parseReportFilters } from "@/lib/report-params";
import type { ReportFilters } from "@/lib/store-shared";
import type { ToolDef } from "./types";

// Bloque de propiedades de filtro reutilizado en varias tools.
const FILTER_PROPS = {
  from: { type: "string", description: "Fecha inicio inclusive YYYY-MM-DD (opcional)" },
  to: { type: "string", description: "Fecha fin inclusive YYYY-MM-DD (opcional)" },
  people: { type: "array", items: { type: "string" }, description: "IDs de persona (de listarFiltros.people[].value)" },
  subprojects: { type: "array", items: { type: "string" }, description: "Nombres de subproyecto" },
  projects: { type: "array", items: { type: "string" }, description: "Nombres de proyecto" },
  companies: { type: "array", items: { type: "string" }, description: "Nombres de empresa" },
} as const;

const filterObject = (extra: Record<string, unknown> = {}) => ({ type: "object", properties: { ...FILTER_PROPS, ...extra } });

export const TOOL_DEFS: ToolDef[] = [
  { name: "listarFiltros", description: "Lista los valores válidos de personas (con id y nombre), subproyectos, proyectos y empresas. Úsalo ANTES de filtrar por nombre.", parameters: { type: "object", properties: {} } },
  { name: "totalesPorPersona", description: "Horas y número de registros por persona dentro de los filtros.", parameters: filterObject() },
  { name: "totalesPorSubproyecto", description: "Horas y número de registros por subproyecto dentro de los filtros.", parameters: filterObject() },
  { name: "lineaDeTiempo", description: "Horas agregadas por semana o mes dentro de los filtros.", parameters: filterObject({ granularity: { type: "string", enum: ["week", "month"], description: "Agrupación temporal (default month)" } }) },
  { name: "matriz", description: "Matriz dimensión × semana. dim=subproject: filas por subproyecto (usar con 1 persona filtrada). dim=person: filas por persona (usar con 1 subproyecto).", parameters: filterObject({ dim: { type: "string", enum: ["person", "subproject"], description: "Dimensión de las filas" } }) },
  { name: "detalle", description: "Filas individuales (paginadas por cursor keyset) dentro de los filtros.", parameters: filterObject({ cursor: { type: "string", description: "Cursor de la página anterior (opcional)" }, limit: { type: "number", description: "1..200 (default 50)" } }) },
];

class ToolArgError extends Error {}

function buildFilters(args: Record<string, unknown>): ReportFilters {
  const sp = new URLSearchParams();
  if (typeof args.from === "string") sp.set("from", args.from);
  if (typeof args.to === "string") sp.set("to", args.to);
  for (const [k, key] of [["people", "person"], ["subprojects", "subproject"], ["projects", "project"], ["companies", "company"]] as const) {
    const v = args[k];
    if (Array.isArray(v)) for (const item of v) if (item != null) sp.append(key, String(item));
  }
  const r = parseReportFilters(sp);
  if (!r.ok) throw new ToolArgError(r.error);
  return r.filters;
}

export async function runTool(name: string, rawArgs: string): Promise<unknown> {
  let args: Record<string, unknown>;
  try {
    args = rawArgs && rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { error: "argumentos no son JSON válido" };
  }
  try {
    switch (name) {
      case "listarFiltros":
        return await reportFilters();
      case "totalesPorPersona":
        return await reportByPerson(buildFilters(args));
      case "totalesPorSubproyecto":
        return await reportBySubproject(buildFilters(args));
      case "lineaDeTiempo":
        return await reportTimeline(buildFilters(args), args.granularity === "week" ? "week" : "month");
      case "matriz": {
        if (args.dim !== "person" && args.dim !== "subproject") return { error: "dim debe ser 'person' o 'subproject'" };
        return await reportMatrix(buildFilters(args), args.dim);
      }
      case "detalle": {
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const cursor = typeof args.cursor === "string" ? args.cursor : null;
        return await reportDetail(buildFilters(args), cursor, limit);
      }
      default:
        return { error: `herramienta desconocida: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "error ejecutando la herramienta" };
  }
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run tests/unit/llm-tools.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Verificar (sin commit)**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

---

### Task 4: Loop de agente

**Files:**
- Create: `src/lib/llm/agent.ts`
- Test: `tests/unit/llm-agent.test.ts`

**Interfaces:**
- Consumes: `chatComplete`, `__setLlmClient`, `__resetLlmClient` (Task 1); `TOOL_DEFS`, `runTool` (Task 3); `ChatMessage`, `ProviderConfig` (Task 1).
- Produces: `MAX_ITERS: number`; `ToolTraceItem = { name: string; args: string; ok: boolean }`; `runChat(provider, messages, now): Promise<{ reply: string; toolTrace: ToolTraceItem[] }>` donde `messages` son solo `{ role: "user" | "assistant"; content: string }`.

- [ ] **Step 1: Escribir el test que falla**

`tests/unit/llm-agent.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as db from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";
import { runChat, MAX_ITERS } from "@/lib/llm/agent";
import { __setLlmClient, __resetLlmClient } from "@/lib/llm/client";
import type { ChatResult, ProviderConfig } from "@/lib/llm/types";
import { REPORT_SEED } from "../fixtures/reportCases";

const provider: ProviderConfig = { id: "ollama", label: "x", baseUrl: "http://x/v1", model: "q" };
const NOW = new Date("2026-07-23T00:00:00Z");

beforeEach(async () => {
  db.__setStore(newMemoryStore());
  await db.upsertRows(REPORT_SEED);
});
afterEach(() => __resetLlmClient());

describe("runChat", () => {
  it("ejecuta el tool que pide el modelo y compone la respuesta final", async () => {
    const scripted: ChatResult[] = [
      { content: "", toolCalls: [{ id: "c1", name: "totalesPorPersona", arguments: JSON.stringify({ from: "2026-06-01", to: "2026-06-30" }) }] },
      { content: "Beto registró 4 h y Ana 3.5 h.", toolCalls: [] },
    ];
    let i = 0;
    const seen: ChatMessageLike[][] = [];
    __setLlmClient(async (_p, messages) => { seen.push(messages as ChatMessageLike[]); return scripted[i++]; });

    const { reply, toolTrace } = await runChat(provider, [{ role: "user", content: "¿horas de junio por persona?" }], NOW);
    expect(reply).toContain("Beto");
    expect(toolTrace).toEqual([{ name: "totalesPorPersona", args: expect.any(String), ok: true }]);
    // El primer mensaje siempre es el system prompt con la fecha de hoy.
    expect(seen[0][0].role).toBe("system");
    expect(seen[0][0].content).toContain("2026-07-23");
    // En la 2a llamada el modelo ya vio el resultado del tool.
    const toolMsg = seen[1].find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("Beto");
  });

  it("marca ok:false cuando el tool devuelve error", async () => {
    __setLlmClient(async (_p, _m, tools) =>
      tools.length
        ? { content: "", toolCalls: [{ id: "c1", name: "matriz", arguments: JSON.stringify({ dim: "bad" }) }] }
        : { content: "listo", toolCalls: [] },
    );
    const { toolTrace } = await runChat(provider, [{ role: "user", content: "x" }], NOW);
    expect(toolTrace[0]).toMatchObject({ name: "matriz", ok: false });
  });

  it("respeta el tope de iteraciones y pide respuesta final sin tools", async () => {
    __setLlmClient(async (_p, _m, tools) =>
      tools.length
        ? { content: "", toolCalls: [{ id: "x", name: "listarFiltros", arguments: "{}" }] }
        : { content: "resumen final", toolCalls: [] },
    );
    const { reply, toolTrace } = await runChat(provider, [{ role: "user", content: "loop" }], NOW);
    expect(reply).toBe("resumen final");
    expect(toolTrace.length).toBe(MAX_ITERS);
  });
});

interface ChatMessageLike { role: string; content: string }
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run tests/unit/llm-agent.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar el agente**

`src/lib/llm/agent.ts`:
```ts
import { chatComplete } from "./client";
import { TOOL_DEFS, runTool } from "./tools";
import type { ChatMessage, ProviderConfig } from "./types";

export const MAX_ITERS = 5;

export interface ToolTraceItem { name: string; args: string; ok: boolean }

function systemPrompt(now: Date): string {
  const today = now.toISOString().slice(0, 10);
  return [
    "Eres un asistente analítico de la base de datos 'BD Tiempos': un registro de horas trabajadas.",
    `La fecha de hoy es ${today} (UTC).`,
    "Cada registro tiene: persona (propiedad 'Hecho por'), horas ('Registro de horas'), fecha de creación, subproyecto, proyecto y empresa productiva.",
    "Responde SIEMPRE en español, con cifras concretas.",
    "Para CUALQUIER dato numérico usa las herramientas; nunca inventes ni estimes cifras.",
    "El filtro de personas usa IDs: llama 'listarFiltros' para obtener los pares id/nombre y los valores válidos de subproyecto/proyecto/empresa antes de filtrar por nombre.",
    "Si una herramienta devuelve { error }, explica el problema en vez de inventar el resultado.",
  ].join(" ");
}

export async function runChat(
  provider: ProviderConfig,
  userMessages: { role: "user" | "assistant"; content: string }[],
  now: Date,
): Promise<{ reply: string; toolTrace: ToolTraceItem[] }> {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(now) }, ...userMessages];
  const toolTrace: ToolTraceItem[] = [];

  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await chatComplete(provider, messages, TOOL_DEFS);
    if (!res.toolCalls.length) return { reply: res.content, toolTrace };

    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });
    for (const tc of res.toolCalls) {
      const result = await runTool(tc.name, tc.arguments);
      const ok = !(result !== null && typeof result === "object" && "error" in (result as Record<string, unknown>));
      toolTrace.push({ name: tc.name, args: tc.arguments, ok });
      messages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: JSON.stringify(result) });
    }
  }

  // Agotadas las iteraciones: forzamos respuesta final sin herramientas.
  const final = await chatComplete(provider, messages, []);
  return { reply: final.content || "No pude completar la consulta con las herramientas disponibles.", toolTrace };
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run tests/unit/llm-agent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verificar (sin commit)**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores. (Nota: el test declara `ChatMessageLike` al final del archivo; TS lo iza — está bien.)

---

### Task 5: Validación del body del endpoint

**Files:**
- Create: `src/lib/llm/request.ts`
- Test: `tests/unit/llm-request.test.ts`

**Interfaces:**
- Produces: `ChatBodyResult = { ok: true; provider: string; messages: { role: "user" | "assistant"; content: string }[] } | { ok: false; error: string }`; `parseChatBody(body: unknown): ChatBodyResult`.

- [ ] **Step 1: Escribir el test que falla**

`tests/unit/llm-request.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseChatBody } from "@/lib/llm/request";

describe("parseChatBody", () => {
  it("acepta mensajes user/assistant con content string", () => {
    const r = parseChatBody({ provider: "ollama", messages: [{ role: "user", content: "hola" }, { role: "assistant", content: "hey" }] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.provider).toBe("ollama"); expect(r.messages).toHaveLength(2); }
  });

  it("rechaza roles no permitidos (system/tool inyectados)", () => {
    expect(parseChatBody({ provider: "ollama", messages: [{ role: "system", content: "x" }] })).toMatchObject({ ok: false });
    expect(parseChatBody({ provider: "ollama", messages: [{ role: "tool", content: "x" }] })).toMatchObject({ ok: false });
  });

  it("rechaza lista vacía o content ausente/no-string", () => {
    expect(parseChatBody({ provider: "ollama", messages: [] })).toMatchObject({ ok: false });
    expect(parseChatBody({ provider: "ollama", messages: [{ role: "user" }] })).toMatchObject({ ok: false });
    expect(parseChatBody({ provider: "ollama", messages: [{ role: "user", content: 5 }] })).toMatchObject({ ok: false });
  });

  it("rechaza provider ausente o no-string", () => {
    expect(parseChatBody({ messages: [{ role: "user", content: "h" }] })).toMatchObject({ ok: false });
    expect(parseChatBody({ provider: 1, messages: [{ role: "user", content: "h" }] })).toMatchObject({ ok: false });
  });

  it("rechaza body que no es objeto", () => {
    expect(parseChatBody(null)).toMatchObject({ ok: false });
    expect(parseChatBody("x")).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run tests/unit/llm-request.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar la validación**

`src/lib/llm/request.ts`:
```ts
export type ChatBodyResult =
  | { ok: true; provider: string; messages: { role: "user" | "assistant"; content: string }[] }
  | { ok: false; error: string };

export function parseChatBody(body: unknown): ChatBodyResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "bad_body" };
  const b = body as Record<string, unknown>;
  if (typeof b.provider !== "string" || !b.provider) return { ok: false, error: "bad_provider" };
  if (!Array.isArray(b.messages) || b.messages.length === 0) return { ok: false, error: "bad_messages" };

  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const raw of b.messages) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "bad_message" };
    const m = raw as Record<string, unknown>;
    if (m.role !== "user" && m.role !== "assistant") return { ok: false, error: "bad_role" };
    if (typeof m.content !== "string" || !m.content.trim()) return { ok: false, error: "bad_content" };
    messages.push({ role: m.role, content: m.content });
  }
  return { ok: true, provider: b.provider, messages };
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run tests/unit/llm-request.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verificar (sin commit)**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 6: Endpoints + proxy

**Files:**
- Create: `src/app/api/chat/route.ts`
- Create: `src/app/api/chat/providers/route.ts`
- Modify: `src/proxy.ts:5` y `src/proxy.ts:21`
- Setup: `.env.local` (agregar vars de Ollama; **no se commitea**, está en .gitignore)

**Interfaces:**
- Consumes: `parseChatBody` (Task 5), `resolveProvider`/`availableProviders` (Task 2), `runChat` (Task 4).

- [ ] **Step 1: Agregar las env vars de Ollama a `.env.local`**

Agregar al final de `.env.local` (ajusta el modelo al tag real que tengas en `ollama list`):
```
LLM_DEFAULT_PROVIDER=ollama
LLM_OLLAMA_BASE_URL=http://localhost:11434/v1
LLM_OLLAMA_MODEL=qwen3.5
```

- [ ] **Step 2: Crear el endpoint POST del chat**

`src/app/api/chat/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { parseChatBody } from "@/lib/llm/request";
import { resolveProvider } from "@/lib/llm/providers";
import { runChat } from "@/lib/llm/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const parsed = parseChatBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const provider = resolveProvider(parsed.provider);
  if (!provider) return NextResponse.json({ error: "provider_unavailable" }, { status: 400 });

  try {
    const { reply, toolTrace } = await runChat(provider, parsed.messages, new Date());
    return NextResponse.json({ reply, provider: provider.id, toolTrace }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "llm_error" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Crear el endpoint GET de proveedores**

`src/app/api/chat/providers/route.ts`:
```ts
import { NextResponse } from "next/server";
import { availableProviders, resolveProvider } from "@/lib/llm/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = availableProviders().map(({ id, label, model }) => ({ id, label, model }));
  return NextResponse.json(
    { providers, default: resolveProvider(undefined)?.id ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

- [ ] **Step 4: Proteger `/api/chat` en el proxy**

En `src/proxy.ts` línea 5, agregar `"/api/chat"` a `PROTECTED`:
```ts
const PROTECTED = ["/api/export", "/api/sync/status", "/api/reports", "/api/chat"];
```
En `src/proxy.ts` línea 21, agregar las dos rutas al matcher:
```ts
export const config = {
  matcher: ["/api/export/:path*", "/api/sync/status", "/api/reports/:path*", "/api/chat", "/api/chat/:path*"],
};
```

- [ ] **Step 5: Verificar (sin commit) — compila y responde**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

Con `npm run dev` corriendo y sesión iniciada en el navegador, verificar auth y forma:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/chat/providers   # 401 sin cookie
```
Expected: `401`.

En la consola del navegador (ya logueado):
```js
await (await fetch("/api/chat/providers")).json()
// { providers: [{ id:"ollama", label:"Qwen local (qwen3.5)", model:"qwen3.5" }], default:"ollama" }
```

Con Ollama corriendo (`ollama serve` + el modelo descargado), probar el POST:
```js
await (await fetch("/api/chat", { method:"POST", headers:{ "Content-Type":"application/json" },
  body: JSON.stringify({ provider:"ollama", messages:[{ role:"user", content:"¿Cuántas horas registró cada persona en total? Dame el top 3." }] }) })).json()
// { reply:"…", provider:"ollama", toolTrace:[{ name:"totalesPorPersona", ... }] }
```
Expected: `reply` con cifras y `toolTrace` no vacío.

---

### Task 7: UI de la página de chat

**Files:**
- Create: `src/app/db/tiempos/chat/page.tsx`
- Test: verificación manual (navegador) + tsc/lint; E2E en Task 9.

**Interfaces:**
- Consumes: `AppShell` de `@/app/components/app-shell`, `Breadcrumb` de `@/app/components/breadcrumb`, `Spinner` de `@/app/components/spinner`; endpoints de Task 6.

- [ ] **Step 1: Crear la página**

`src/app/db/tiempos/chat/page.tsx`:
```tsx
"use client";
// Asistente IA sobre BD Tiempos: chat con tool-calling sobre los reportes.
// Sin streaming (spinner "pensando…"). El proveedor se elige en el dropdown,
// poblado desde /api/chat/providers. El historial vive en el cliente.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { Breadcrumb } from "@/app/components/breadcrumb";
import { Spinner } from "@/app/components/spinner";

interface ProviderInfo { id: string; label: string; model: string }
interface TraceItem { name: string; args: string; ok: boolean }
interface Msg { role: "user" | "assistant"; content: string; trace?: TraceItem[] }

export default function ChatPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/chat/providers");
      if (r.status === 401) { setAuthed(false); return; }
      setAuthed(true);
      if (r.ok) {
        const data: { providers: ProviderInfo[]; default: string | null } = await r.json();
        setProviders(data.providers);
        setProvider(data.default ?? data.providers[0]?.id ?? "");
      }
    })();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending || !provider) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Error del asistente"); return; }
      setMessages((m) => [...m, { role: "assistant", content: data.reply, trace: data.toolTrace }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló la conexión");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  if (authed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center gap-3 text-muted">
        <Spinner className="text-sky" /><span className="text-sm">Cargando…</span>
      </main>
    );
  }
  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-fg">Asistente IA</h1>
          <p className="text-sm text-muted">Necesitas iniciar sesión para usar el asistente.</p>
          <Link href="/" className="inline-block rounded-lg bg-blue px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110">
            Ir al inicio de sesión
          </Link>
        </div>
      </main>
    );
  }

  const noProvider = providers.length === 0;

  return (
    <AppShell onLogout={() => setAuthed(false)}>
      <main className="mx-auto flex h-[100dvh] max-w-4xl flex-col p-4 sm:p-5">
        <header className="space-y-2 border-b border-border pb-4">
          <Breadcrumb items={[{ label: "Menú", href: "/" }, { label: "BD Tiempos", href: "/db/tiempos/reports" }, { label: "Asistente IA" }]} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-display text-xl font-bold tracking-tight text-fg">Asistente IA</h1>
            <label className="flex items-center gap-2 text-sm text-muted">
              Modelo
              <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={noProvider}
                      className="rounded-lg border border-border bg-dark-blue px-2 py-1.5 text-sm text-fg outline-none [color-scheme:dark] focus:border-blue disabled:opacity-60">
                {noProvider ? <option>— sin proveedor —</option> : providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto py-4">
          {messages.length === 0 && !noProvider && (
            <p className="text-sm text-muted">Pregúntame sobre las horas registradas: totales por persona o subproyecto, evolución semanal, etc.</p>
          )}
          {noProvider && (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              No hay ningún modelo configurado. Define <code className="font-mono text-sky">LLM_OLLAMA_MODEL</code> (Ollama) o las variables de MiniMax en <code className="font-mono">.env.local</code> y reinicia el servidor.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user" ? "bg-blue text-white" : "border border-border bg-surface text-fg"
              }`}>
                {m.content}
                {m.trace && m.trace.length > 0 && (
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer">consultó {m.trace.length} herramienta(s)</summary>
                    <ul className="mt-1 space-y-0.5">
                      {m.trace.map((t, j) => <li key={j} className="font-mono">{t.ok ? "✓" : "✗"} {t.name}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted"><Spinner className="text-sky" /> pensando…</div>
          )}
          <div ref={endRef} />
        </div>

        {error && <p className="pb-2 text-sm text-danger">{error}</p>}

        <div className="flex items-end gap-2 border-t border-border pt-3">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
                    rows={2} disabled={noProvider}
                    placeholder="Escribe tu pregunta…"
                    className="flex-1 resize-none rounded-lg border border-border bg-dark-blue px-3 py-2 text-sm text-fg outline-none [color-scheme:dark] focus:border-blue focus:ring-2 focus:ring-blue/30 disabled:opacity-60" />
          <button onClick={() => void send()} disabled={sending || noProvider || !input.trim()}
                  className="rounded-lg bg-blue px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
            Enviar
          </button>
        </div>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Verificar (sin commit)**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

Con `npm run dev` y sesión iniciada, abrir `http://localhost:3000/db/tiempos/chat`:
Expected: encabezado "Asistente IA", dropdown "Modelo" con "Qwen local (…)", textarea y botón Enviar. Enviar una pregunta devuelve respuesta con el desplegable "consultó N herramienta(s)".

---

### Task 8: Entrada "Asistente IA" en el sidebar

**Files:**
- Modify: `src/app/components/app-shell.tsx` (agregar `ChatIcon` y anidar el link bajo cada BD)

**Interfaces:**
- Consumes: `DATABASES` (ya importado en el archivo), `NavLink` (ya definido).

- [ ] **Step 1: Agregar el ícono de chat**

En `src/app/components/app-shell.tsx`, después de `TableIcon` (línea ~56), agregar:
```tsx
function ChatIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h13a2 2 0 012 2z" />
    </svg>
  );
}
```

- [ ] **Step 2: Anidar el link de chat bajo cada BD**

Reemplazar el bloque del `.map` (líneas ~164-166) por:
```tsx
                {DATABASES.map((db) => (
                  <div key={db.slug} className="space-y-1">
                    <NavLink href={`/db/${db.slug}/reports`} label={db.name} icon={<TableIcon />} onNavigate={close} />
                    <div className="pl-4">
                      <NavLink href={`/db/${db.slug}/chat`} label="Asistente IA" icon={<ChatIcon />} onNavigate={close} />
                    </div>
                  </div>
                ))}
```

- [ ] **Step 3: Verificar (sin commit)**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

En el navegador: el sidebar muestra "BD Tiempos" con "Asistente IA" anidado debajo; al hacer clic navega a `/db/tiempos/chat` y la entrada queda activa (fondo `bg-dark-blue`) sin activar también "BD Tiempos".

---

### Task 9: E2E smoke de la página de chat

**Files:**
- Modify: `tests/e2e/smoke.spec.ts` (agregar un test)

**Interfaces:**
- Consumes: el helper de login existente en el archivo (reutilizar el patrón de los tests actuales).

- [ ] **Step 1: Leer el patrón de login del archivo**

Run: `npx playwright test --list` para confirmar los tests actuales; abrir `tests/e2e/smoke.spec.ts` y localizar cómo se inicia sesión (password `e2e-password`) y cómo se navega por el sidebar en los tests existentes (tests 2 y 4).

- [ ] **Step 2: Agregar el test de chat**

Agregar dentro del `describe` principal de `tests/e2e/smoke.spec.ts` (replicando el login que usan los otros tests logueados):
```ts
test("chat page renders composer and provider control", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/contraseña/i).fill("e2e-password");
  await page.getByRole("button", { name: /entrar/i }).click();

  // Navegar al Asistente por el sidebar (grupo "Bases de datos" ya abierto).
  await page.getByRole("link", { name: "Asistente IA" }).click();
  await expect(page).toHaveURL(/\/db\/tiempos\/chat$/);

  await expect(page.getByRole("heading", { name: "Asistente IA" })).toBeVisible();
  await expect(page.getByPlaceholder("Escribe tu pregunta…")).toBeVisible();
  // Sin LLM configurado en el server E2E, aparece el aviso de configuración.
  await expect(page.getByText(/no hay ningún modelo configurado/i)).toBeVisible();
});
```

> Nota: los selectores de login (`getByLabel(/contraseña/i)`, botón `/entrar/i`) deben coincidir EXACTAMENTE con los que ya usan los tests logueados del archivo. Si difieren, copiar el bloque de login textual de un test existente (p. ej. el test "login shows main menu…").

- [ ] **Step 3: Correr el E2E**

Run: `npm run test:e2e`
Expected: todos los tests PASAN, incluido el nuevo. (Recordatorio del CLAUDE.md / memoria [[e2e-build-pisa-next]]: `test:e2e` hace `next build` sobre `.next`; si el `npm run dev` del usuario está abierto, se corrompe. Cerrar el dev server antes de correr E2E, o avisar al usuario.)

- [ ] **Step 4: Verificar (sin commit)**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 10: Encender MiniMax (solo configuración)

**Files:**
- Setup: `.env.local` (agregar vars de MiniMax; no se commitea)
- No hay cambios de código: la capa de proveedor ya lo soporta.

**Interfaces:** ninguno nuevo — valida el diseño multi-proveedor de Tasks 1-2.

- [ ] **Step 1: Agregar las env vars de MiniMax**

En `.env.local` (usar la base URL OpenAI-compatible y el modelo reales de tu cuenta MiniMax):
```
LLM_MINIMAX_BASE_URL=<base url OpenAI-compatible de MiniMax, terminada en /v1>
LLM_MINIMAX_API_KEY=<tu token>
LLM_MINIMAX_MODEL=<nombre del modelo>
```
Reiniciar `npm run dev`.

- [ ] **Step 2: Verificar que aparece como proveedor**

En la consola del navegador (logueado):
```js
await (await fetch("/api/chat/providers")).json()
// providers incluye { id:"minimax", label:"MiniMax (…)", model:"…" }
```
Expected: `minimax` en la lista; en la UI el dropdown "Modelo" ahora ofrece MiniMax.

- [ ] **Step 3: Verificar tool-calling con MiniMax**

En la UI, elegir MiniMax y preguntar "¿Top 3 de personas por horas totales?".
Expected: respuesta con cifras y el desplegable "consultó N herramienta(s)" con `totalesPorPersona`. Si MiniMax no emite tool-calls (según el modelo), el `reply` saldrá sin `toolTrace` y sin cifras confiables — en ese caso, dejar constancia y elegir un modelo MiniMax con soporte de function-calling.

- [ ] **Step 4: Verificación final del árbol (sin commit)**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: sin errores; suite unit completa en verde (incluye los 5 nuevos archivos `llm-*`).

---

## Notas de cierre

- **Sin commits**: todo queda sin versionar (instrucción de sesión). Cuando decidas commitear, el orden natural es Tasks 1-5 (libs + tests), 6 (endpoints/proxy), 7-8 (UI), 9 (E2E); `.env.local` nunca se commitea.
- **Fuera de alcance** (según spec): streaming, text-to-SQL, persistir historial, identidad por usuario, sincronizar chat con filtros de reportes.
