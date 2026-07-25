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
