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
