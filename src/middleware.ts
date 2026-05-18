import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

const PROTECTED = ["/api/export", "/api/sync/status"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /api/sync acepta cookie de usuario O Bearer del cron — manejado en la route.
  if (!PROTECTED.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const res = NextResponse.next();
  // @ts-expect-error iron-session typing
  const session = await getIronSession<SessionData>(req.cookies, sessionOptions);
  if (!session.authenticated) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return res;
}

export const config = {
  matcher: ["/api/export/:path*", "/api/sync/status"],
};
