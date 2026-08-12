import { NextRequest, NextResponse } from "next/server";
import { unblockUser, blockUser, deleteUser, listUsers } from "@/lib/db";
import { canEditUser, normalizeEmail } from "@/lib/authz";
import { adminActor, forbidden, badRequest } from "@/lib/admin-actor";

export const dynamic = "force-dynamic";

/** Tope por llamada. No es una regla de negocio: es que un pegado accidental no
 *  escriba cientos de filas en la tabla que decide quién entra. */
const MAX_POR_LLAMADA = 50;

/** Forma de correo, no existencia. Deliberadamente laxa —validar direcciones a
 *  fondo con una expresión regular es una trampa conocida—: alcanza con atajar el
 *  typo que metería basura permanente en una lista que nadie vuelve a mirar. */
const CON_FORMA_DE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Bloquear por adelantado a uno o varios correos, hayan entrado alguna vez o no.
 *
 * Existe porque la única vía anterior era DELETE /api/admin/users, que parte de una
 * fila ya existente: no había forma de dejar cerrada la puerta ANTES del primer
 * ingreso (alguien que se va la semana próxima, una cuenta que no debe abrirse).
 *
 * NO se filtra por ALLOWED_EMAIL_DOMAINS: esta lista sólo deniega, así que anotar
 * un correo de otro dominio no otorga nada y no vale la pena prohibirlo.
 *
 * Se valida TODO antes de escribir nada: un lote con un typo no debe dejar la mitad
 * de los correos bloqueados y la otra mitad no, porque no hay pantalla que muestre
 * qué quedó a medias.
 */
export async function POST(req: NextRequest) {
  const me = await adminActor();
  if (!me) return forbidden();

  const body = (await req.json().catch(() => null)) as { emails?: unknown } | null;
  const crudos = body?.emails;
  if (!Array.isArray(crudos) || crudos.length === 0) return badRequest();
  if (crudos.some((e) => typeof e !== "string")) return badRequest();

  // Normalizar antes de deduplicar: `Pablo@` y `pablo@` son la misma persona, y
  // dos filas harían que levantar el bloqueo dejara la otra en pie.
  const correos = [...new Set((crudos as string[]).map(normalizeEmail).filter((e) => e !== ""))];
  if (correos.length === 0) return badRequest();
  if (correos.length > MAX_POR_LLAMADA) {
    return NextResponse.json({ error: "too_many", max: MAX_POR_LLAMADA }, { status: 400 });
  }

  const invalidos = correos.filter((e) => !CON_FORMA_DE_CORREO.test(e));
  if (invalidos.length > 0) {
    return NextResponse.json({ error: "bad_email", invalid: invalidos }, { status: 400 });
  }

  // Misma regla que el resto: nadie se opera a sí mismo, y de ahí sale que nunca
  // puedan quedar cero admins.
  if (correos.some((e) => !canEditUser(me, e))) {
    return NextResponse.json({ error: "self" }, { status: 409 });
  }

  // Una sola lectura de la tabla para todo el lote: el nombre sirve para que la
  // lista muestre personas y no sólo correos, y después de borrar la fila ya no
  // habría de dónde sacarlo.
  const porCorreo = new Map((await listUsers()).map((u) => [u.email, u.name]));
  for (const email of correos) {
    await blockUser(email, porCorreo.get(email) ?? null, me);
    // Si nunca entró esto es un no-op; si tenía fila, evita que aparezca a la vez
    // en las dos listas de la pantalla.
    await deleteUser(email);
  }
  return NextResponse.json({ ok: true, blocked: correos.length });
}

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
