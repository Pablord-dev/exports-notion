import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { runSync } from "@/lib/sync";
import { requestCancel } from "@/lib/cache";
import type { SyncKind } from "@/lib/types";

export const dynamic = "force-dynamic";
// Vercel Hobby cap = 60 s. Cada llamada hace 1 segmento del full (~35 s) o el incremental completo.
export const maxDuration = 60;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && bearer === process.env.CRON_SECRET) return true;
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  return Boolean(session.authenticated);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const kind = (req.nextUrl.searchParams.get("kind") ?? "incremental") as SyncKind;
  if (kind !== "incremental" && kind !== "full") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  // Await inline: en Vercel Hobby las funciones se matan al responder, así que el
  // patrón "void runSync()" no es confiable. El cliente espera el resultado de
  // este segmento y, si es full y `done:false`, vuelve a llamar.
  const result = await runSync(kind);
  if (!result.ok) {
    const status = result.reason === "locked" ? 409 : 500;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await requestCancel();
  return NextResponse.json({ cancelling: true });
}
