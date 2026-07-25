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
