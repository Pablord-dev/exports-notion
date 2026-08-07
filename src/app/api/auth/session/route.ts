import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

/**
 * Quién está dentro. NO está en el matcher de proxy.ts a propósito: tiene que
 * poder contestar { authenticated: false } sin sesión en vez de 401, porque la
 * llama el shell y no un consumidor de datos.
 */
export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.authenticated) return NextResponse.json({ authenticated: false });
  return NextResponse.json({ authenticated: true, user: session.user ?? null });
}
