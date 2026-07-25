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
