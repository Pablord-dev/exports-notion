import { NextRequest, NextResponse } from "next/server";
import { unblockUser } from "@/lib/db";
import { adminActor, forbidden, badRequest } from "@/lib/admin-actor";

export const dynamic = "force-dynamic";

/**
 * Restaurar el acceso: saca a alguien de la lista de bloqueo.
 *
 * ⚠️ NO le devuelve el rol que tenía. Su fila de `users` se borró al bloquearlo,
 * así que vuelve como lectura en su próximo login; a un admin bloqueado hay que
 * volver a promoverlo. Es a propósito: recordar el rol de alguien a quien se le
 * quitó el acceso sería guardar un permiso que nadie está revisando.
 *
 * La lista se lee por GET /api/admin/users, junto a los usuarios: la pantalla
 * muestra las dos cosas a la vez y separarlas costaría un round-trip.
 */
export async function DELETE(req: NextRequest) {
  if (!(await adminActor())) return forbidden();

  const email = req.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email) return badRequest();

  // Sin regla de "uno mismo": nadie puede bloquearse solo, así que tampoco puede
  // aparecer en esta lista.
  await unblockUser(email);
  return NextResponse.json({ ok: true });
}
