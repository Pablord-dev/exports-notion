import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { listUsers, deleteUser, getUserRole, setUserRole } from "@/lib/db";
import { canEditUser, canManageUsers, roleOrDefault, type Role } from "@/lib/authz";

export const dynamic = "force-dynamic";

const ROLES = new Set<string>(["admin", "viewer"]);

/**
 * El correo de quien pide, si puede administrar; null si no.
 *
 * ⚠️ SIN try/catch a propósito, al revés que /api/auth/session y el callback de
 * Google: este es el punto que DECIDE un permiso, así que un error de base tiene
 * que cortar la petición (500) y no degradar a "pasá". El fail-open acá regalaría
 * la administración de usuarios ante cualquier hipo de la base.
 *
 * La ruta está en el matcher de proxy.ts, así que llegar sin sesión ya es 401;
 * el null de acá cubre la sesión sin email (cookie previa a ADR-0008) y al viewer.
 */
async function actor(): Promise<string | null> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const email = session.user?.email;
  if (!email) return null;
  const role = roleOrDefault(await getUserRole(email));
  return canManageUsers(role) ? email : null;
}

const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

export async function GET() {
  if (!(await actor())) return forbidden();
  return NextResponse.json({ users: await listUsers() });
}

export async function PATCH(req: NextRequest) {
  const me = await actor();
  if (!me) return forbidden();

  const body = (await req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role;
  if (!email) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (typeof role !== "string" || !ROLES.has(role)) {
    return NextResponse.json({ error: "bad_role" }, { status: 400 });
  }
  // Nadie se degrada a sí mismo: de ahí sale que nunca queden cero admins.
  if (!canEditUser(me, email)) return NextResponse.json({ error: "self" }, { status: 409 });

  // setUserRole crea la fila si no existe, igual que scripts/set-role.cjs. La UI
  // no expone esa vía (no hay campo para escribir correos) y crear una fila no le
  // da acceso a nadie —la puerta es el dominio—, así que no se prohíbe.
  await setUserRole(email, role as Role);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const me = await actor();
  if (!me) return forbidden();

  const email = req.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!canEditUser(me, email)) return NextResponse.json({ error: "self" }, { status: 409 });

  await deleteUser(email);
  return NextResponse.json({ ok: true });
}
