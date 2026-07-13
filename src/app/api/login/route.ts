import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, verifyPassword, type SessionData } from "@/lib/auth";
import { rateLimitLogin } from "@/lib/db";

export async function POST(req: NextRequest) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // 5 intentos / 15 min por IP (ventana fija en login_attempts; E2E usa el store en memoria).
  if (!(await rateLimitLogin(ip))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || !(await verifyPassword(password))) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.authenticated = true;
  await session.save();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.destroy();
  return NextResponse.json({ ok: true });
}
