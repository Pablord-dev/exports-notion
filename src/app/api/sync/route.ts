import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { runSync } from "@/lib/sync";
import { requestCancel } from "@/lib/cache";
import type { SyncKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min (Vercel pro)

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
  // No await: dispara en background y responde 202.
  void runSync(kind);
  return NextResponse.json({ accepted: true, kind }, { status: 202 });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await requestCancel();
  return NextResponse.json({ cancelling: true });
}
