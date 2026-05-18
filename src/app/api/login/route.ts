import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getIronSession } from "iron-session";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { sessionOptions, verifyPassword, type SessionData } from "@/lib/auth";

const limiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  prefix: "notion:ratelimit:login",
});

export async function POST(req: NextRequest) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await limiter.limit(ip);
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
