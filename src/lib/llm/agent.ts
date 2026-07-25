import { chatComplete } from "./client";
import { TOOL_DEFS, runTool } from "./tools";
import type { ChatMessage, ProviderConfig } from "./types";

export const MAX_ITERS = 5;

export interface ToolTraceItem { name: string; args: string; ok: boolean }

// Los modelos de razonamiento (p. ej. MiniMax-M3) emiten su cadena de
// pensamiento en un bloque <think>…</think> dentro del content; se quita
// de la respuesta visible al usuario.
function cleanReply(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function systemPrompt(now: Date, dbName: string): string {
  const today = now.toISOString().slice(0, 10);
  return [
    `Eres un asistente analítico de la base de datos «${dbName}»: un registro de horas trabajadas.`,
    `La fecha de hoy es ${today} (UTC).`,
    "Cada registro tiene: persona (propiedad 'Hecho por'), horas ('Registro de horas'), fecha de creación, subproyecto, proyecto y empresa productiva.",
    "Responde SIEMPRE en español, con cifras concretas.",
    "Para CUALQUIER dato numérico usa las herramientas; nunca inventes ni estimes cifras.",
    "Los filtros (from, to, people, subprojects, projects, companies) son TODOS OPCIONALES. Si el usuario no especifica un rango de fechas, consulta TODOS los registros llamando la herramienta SIN 'from' ni 'to'.",
    "NUNCA pidas aclaraciones sobre datos que puedes obtener llamando una herramienta: llama la herramienta directamente (con o sin filtros) y responde con lo que devuelva.",
    "El filtro de personas usa IDs: llama 'listarFiltros' para obtener los pares id/nombre y los valores válidos de subproyecto/proyecto/empresa antes de filtrar por nombre.",
    "Si una herramienta devuelve { error }, explica el problema en vez de inventar el resultado.",
  ].join(" ");
}

export async function runChat(
  provider: ProviderConfig,
  userMessages: { role: "user" | "assistant"; content: string }[],
  now: Date,
  dbName = "BD Tiempos",
): Promise<{ reply: string; toolTrace: ToolTraceItem[] }> {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(now, dbName) }, ...userMessages];
  const toolTrace: ToolTraceItem[] = [];

  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await chatComplete(provider, messages, TOOL_DEFS);
    if (!res.toolCalls.length) return { reply: cleanReply(res.content), toolTrace };

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
  return { reply: cleanReply(final.content) || "No pude completar la consulta con las herramientas disponibles.", toolTrace };
}
