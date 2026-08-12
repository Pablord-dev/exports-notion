import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { safeRoleFor } from "@/lib/user-role";
import { isBlocked } from "@/lib/db";

/**
 * Quién está dentro. NO está en el matcher de proxy.ts a propósito: tiene que
 * poder contestar { authenticated: false } sin sesión en vez de 401, porque la
 * llama el shell y no un consumidor de datos.
 *
 * El `role` se lee de la tabla en cada request y NO de la cookie: la sesión dura
 * 7 días y un rol sellado ahí haría que una degradación tardara eso en surtir
 * efecto. Sólo sirve para dibujar (mostrar u ocultar la sección Usuarios); quien
 * autoriza de verdad es /api/admin/users.
 */
export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.authenticated) return NextResponse.json({ authenticated: false });

  // Esta ruta está fuera del matcher del proxy, así que el bloqueo lo mira ella.
  // Es lo que el shell polea para expulsar a quien perdió el acceso con una
  // pantalla abierta. Fail-closed —al revés que el rol de abajo—: si no se puede
  // saber, se responde "no hay sesión". Un falso negativo manda a la pantalla de
  // ingreso; un falso positivo dejaría adentro a quien ya no debería estar.
  const email = session.user?.email;
  if (email) {
    try {
      if (await isBlocked(email)) return NextResponse.json({ authenticated: false });
    } catch (e) {
      console.error("[auth] no se pudo verificar la lista de bloqueo", e);
      return NextResponse.json({ authenticated: false });
    }
  }

  return NextResponse.json({
    authenticated: true,
    user: session.user ?? null,
    role: await safeRoleFor(session.user?.email),
  });
}
