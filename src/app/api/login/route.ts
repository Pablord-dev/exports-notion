import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getIronSession } from "iron-session";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { sessionOptions, verifyPassword, type SessionData } from "@/lib/auth";
import { memoryRatelimit } from "@/lib/memory-redis";

// Perezoso: Ratelimit usa EVAL (Lua) contra el REST API, así que no puede
// operar sobre el stub en memoria — con E2E_STUBS=1 se sustituye completo.
interface Limiter { limit(id: string): Promise<{ success: boolean }>; }
let limiter: Limiter | null = null;
function getLimiter(): Limiter {
  if (!limiter) {
    limiter = process.env.E2E_STUBS === "1"
      ? memoryRatelimit(5, 15 * 60_000)
      : new Ratelimit({
          redis: Redis.fromEnv(),
          limiter: Ratelimit.slidingWindow(5, "15 m"),
          prefix: "notion:ratelimit:login",
        });
  }
  return limiter;
}

export async function POST(req: NextRequest) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await getLimiter().limit(ip);
  if (!success) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

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
