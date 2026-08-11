import { NextRequest, NextResponse } from "next/server";
import { listUsers, deleteUser, listBlocked, blockUser, setUserRole } from "@/lib/db";
import { canEditUser, normalizeEmail, type Role } from "@/lib/authz";
import { adminActor, forbidden, badRequest } from "@/lib/admin-actor";

export const dynamic = "force-dynamic";

const ROLES = new Set<string>(["admin", "viewer"]);

/** Ambas listas en una sola respuesta: la pantalla las muestra juntas y separar
 *  la lectura en dos rutas sólo agregaría un round-trip. */
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const [users, blocked] = await Promise.all([listUsers(), listBlocked()]);
  return NextResponse.json({ users, blocked });
}

export async function PATCH(req: NextRequest) {
  const me = await adminActor();
  if (!me) return forbidden();

  const body = (await req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role;
  if (!email) return badRequest();
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

/**
 * Quitarle el acceso a alguien: borra su fila de `users` (pierde el rol y sale de
 * la lista) y lo pasa a la lista de bloqueo.
 *
 * Son dos escrituras y no una porque responden preguntas distintas: `users` es
 * "quién tiene acceso y con qué rol", `blocked_users` es "a quién se lo quitamos".
 * El bloqueo es lo que de verdad lo saca: sin él, su cookie —sellada, de 7 días—
 * seguiría valiendo, que es exactamente lo que pasaba antes de este cambio.
 */
export async function DELETE(req: NextRequest) {
  const me = await adminActor();
  if (!me) return forbidden();

  const email = req.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email) return badRequest();
  if (!canEditUser(me, email)) return NextResponse.json({ error: "self" }, { status: 409 });

  // El nombre se copia ANTES de borrar la fila: después ya no hay de dónde
  // sacarlo, y la lista de bloqueo mostraría sólo correos. La tabla tiene decenas
  // de filas, así que buscarlo en la lista sale más barato que un método nuevo
  // del Store con su implementación por duplicado.
  const clave = normalizeEmail(email);
  const nombre = (await listUsers()).find((u) => u.email === clave)?.name ?? null;
  await blockUser(email, nombre, me);
  await deleteUser(email);
  return NextResponse.json({ ok: true });
}
