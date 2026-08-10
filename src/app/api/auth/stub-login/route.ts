import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { setUserRole } from "@/lib/db";

/**
 * Entrada de los E2E: Playwright no puede hablar con Google real. Mismo modelo
 * de confianza que tenía la concesión de verifyPassword con E2E_STUBS, y misma
 * mitigación: sin la bandera esta ruta NO EXISTE (404), y E2E_STUBS nunca se
 * define en Vercel.
 *
 * Los correos siguen fijos —están acá, no llegan por query—: lo que el comentario
 * original protegía es la inyección de IDENTIDAD, y eso no cambia. `?role` sí se
 * acepta, porque probar el veto del full exige poder entrar como viewer, y la ruta
 * ya emite una sesión sin credenciales. Default admin, así los E2E previos a los
 * roles siguen pasando sin tocarlos.
 *
 * ⚠️ Un correo por rol, no uno solo con el rol cambiándole encima: la suite corre
 * `fullyParallel` contra UN server cuyo memory-store es un singleton de proceso,
 * así que con identidad compartida el login admin de un test le arrebataba el rol
 * al viewer de otro a mitad de camino (rojo intermitente, visto 2026-08-10).
 */
const STUB_USERS = {
  admin: { email: "e2e@hiuman.edu.mx", name: "Usuario E2E" },
  viewer: { email: "e2e-viewer@hiuman.edu.mx", name: "Usuario E2E (viewer)" },
} as const;

export async function GET(req: NextRequest) {
  if (process.env.E2E_STUBS !== "1") {
    return new NextResponse(null, { status: 404 });
  }
  const role = req.nextUrl.searchParams.get("role") ?? "admin";
  if (role !== "admin" && role !== "viewer") {
    // 400 y no un default silencioso: un typo en un test tiene que doler acá y no
    // convertirse en un E2E que prueba el rol equivocado y pasa igual.
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }
  const user = STUB_USERS[role];
  // Se escribe ANTES de sellar la sesión: el parámetro es la autoridad, así que no
  // compite con lo que haya quedado de una corrida anterior en el store singleton.
  await setUserRole(user.email, role);

  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.authenticated = true;
  session.user = user;
  await session.save();
  // Contra el origin del request, NO contra APP_ORIGIN: el E2E corre en :3100 y
  // `next start` pisa el env heredado con .env.local, que dice :3000. Con
  // APP_ORIGIN, Playwright acabaría en otro server.
  return NextResponse.redirect(new URL("/", req.nextUrl.origin));
}
