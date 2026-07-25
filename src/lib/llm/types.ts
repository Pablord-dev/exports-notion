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
