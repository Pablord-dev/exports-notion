import { NextResponse } from "next/server";
import { availableProviders, resolveProvider } from "@/lib/llm/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = availableProviders().map(({ id, label, model }) => ({ id, label, model }));
  return NextResponse.json(
    { providers, default: resolveProvider(undefined)?.id ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
