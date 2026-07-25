import { NextRequest, NextResponse } from "next/server";
import { parseChatBody } from "@/lib/llm/request";
import { resolveProvider } from "@/lib/llm/providers";
import { runChat } from "@/lib/llm/agent";
import { DATABASES } from "@/lib/databases";

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

  // BD activa (informativa para el prompt); default a la única registrada.
  const dbSlug = typeof (body as { db?: unknown }).db === "string" ? (body as { db: string }).db : undefined;
  const dbDef = DATABASES.find((d) => d.slug === dbSlug) ?? DATABASES[0];

  try {
    const { reply, toolTrace } = await runChat(provider, parsed.messages, new Date(), dbDef?.name);
    return NextResponse.json({ reply, provider: provider.id, toolTrace }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "llm_error" }, { status: 502 });
  }
}
