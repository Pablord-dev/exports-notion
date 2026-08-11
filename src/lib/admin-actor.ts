// Gate de las rutas de administración. Vive aparte porque lo comparten
// /api/admin/users y /api/admin/blocked, y duplicarlo haría que una se arregle y
// la otra no.
//
// ⚠️ SIN try/catch a propósito, al revés que `safeRoleFor`: este es el punto que
// DECIDE un permiso, así que un error de base tiene que cortar la petición (500)
// y no degradar a "pasá". El fail-open acá regalaría la administración de
// usuarios ante cualquier hipo de la base.
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { NextResponse } from "next/server";
import { sessionOptions, type SessionData } from "@/lib/session";
import { getUserRole } from "@/lib/db";
import { canManageUsers, roleOrDefault } from "@/lib/authz";

/**
 * El correo de quien pide, si puede administrar; null si no.
 *
 * Las rutas /api/admin/* están en el matcher de proxy.ts, así que llegar sin
 * sesión ya es 401; el null de acá cubre la sesión sin email (cookie previa a
 * ADR-0008) y al viewer.
 */
export async function adminActor(): Promise<string | null> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const email = session.user?.email;
  if (!email) return null;
  const role = roleOrDefault(await getUserRole(email));
  return canManageUsers(role) ? email : null;
}

export const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 });
export const badRequest = () => NextResponse.json({ error: "bad_request" }, { status: 400 });
