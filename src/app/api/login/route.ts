import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, verifyPassword, type SessionData } from "@/lib/auth";
import { rateLimitLogin } from "@/lib/db";

export async function POST(req: NextRequest) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // 5 intentos / 15 min por IP (ventana fija en login_attempts; E2E usa el store en memoria).
  // E2E_STUBS=1: Playwright local no manda x-forwarded-for, así que todos los
  // tests —de todos los specs, en todos los workers— comparten el bucket
  // "unknown"; 5 intentos agotan la ventana para el resto de la corrida (visto
  // en la Tarea 5 al sumar más specs con su propio login). El límite real
  // sigue cubierto por tests/integration/db.pg.test.ts contra SQL. Mismo
  // patrón de concesión que verifyPassword en src/lib/auth.ts.
  if (process.env.E2E_STUBS !== "1" && !(await rateLimitLogin(ip))) {
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
