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
