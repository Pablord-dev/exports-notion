import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as db from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";
import { runChat, MAX_ITERS } from "@/lib/llm/agent";
import { __setLlmClient, __resetLlmClient } from "@/lib/llm/client";
import type { ChatResult, ProviderConfig } from "@/lib/llm/types";
import { REPORT_SEED } from "../fixtures/reportCases";

const provider: ProviderConfig = { id: "ollama", label: "x", baseUrl: "http://x/v1", model: "q" };
const NOW = new Date("2026-07-23T00:00:00Z");

interface ChatMessageLike { role: string; content: string }

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

  it("quita el bloque <think>…</think> de la respuesta visible (modelos de razonamiento)", async () => {
    __setLlmClient(async () => ({ content: "<think>debo sumar las horas</think>\n\nAna lidera con 12 h.", toolCalls: [] }));
    const { reply } = await runChat(provider, [{ role: "user", content: "resumen" }], NOW);
    expect(reply).toBe("Ana lidera con 12 h.");
    expect(reply).not.toContain("<think>");
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
