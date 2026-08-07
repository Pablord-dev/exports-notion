import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

/**
 * Entrada de los E2E: Playwright no puede hablar con Google real. Mismo modelo
 * de confianza que tenía la concesión de verifyPassword con E2E_STUBS, y misma
 * mitigación: sin la bandera esta ruta NO EXISTE (404), y E2E_STUBS nunca se
 * define en Vercel. Sin parámetros a propósito —correo fijo, nada que inyectar—.
 */
const STUB_USER = { email: "e2e@hiuman.edu.mx", name: "Usuario E2E" };

export async function GET(req: NextRequest) {
  if (process.env.E2E_STUBS !== "1") {
    return new NextResponse(null, { status: 404 });
  }
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.authenticated = true;
  session.user = STUB_USER;
  await session.save();
  // Contra el origin del request, NO contra APP_ORIGIN: el E2E corre en :3100 y
  // `next start` pisa el env heredado con .env.local, que dice :3000. Con
  // APP_ORIGIN, Playwright acabaría en otro server.
  return NextResponse.redirect(new URL("/", req.nextUrl.origin));
}
