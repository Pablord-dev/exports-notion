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
