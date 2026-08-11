import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { runSync } from "@/lib/sync";
import { getStatus, getUserRole, requestCancel } from "@/lib/db";
import { canCancel, canTrigger, roleOrDefault, type Role } from "@/lib/authz";
import type { SyncKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min (Vercel pro)

/** Quién llama. Antes esto era un booleano; ahora la identidad importa, porque el
 *  permiso depende del rol y no sólo de tener sesión. */
type Caller = { via: "cron" } | { via: "session"; email: string | null };

async function identify(req: NextRequest): Promise<Caller | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && bearer === process.env.CRON_SECRET) return { via: "cron" };
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.authenticated) return null;
  return { via: "session", email: session.user?.email ?? null };
}

/** El cron conserva permisos plenos: es el canal del incremental diario declarado
 *  en vercel.json y no tiene una persona detrás a quien asignarle un rol. Una
 *  sesión sin email (cookie previa a ADR-0008) cae a viewer. */
async function roleOf(caller: Caller): Promise<Role> {
  if (caller.via === "cron") return "admin";
  if (!caller.email) return "viewer";
  return roleOrDefault(await getUserRole(caller.email));
}

export async function POST(req: NextRequest) {
  const caller = await identify(req);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // El kind se valida antes del rol: un kind inventado es 400 para cualquiera, y
  // así no se paga una consulta a la base para rechazarlo.
  const kind = (req.nextUrl.searchParams.get("kind") ?? "incremental") as SyncKind;
  if (kind !== "incremental" && kind !== "full") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  // 403 y no 401: la sesión es válida, lo que falta es el rol. Son dos problemas
  // distintos y el cliente los trata distinto.
  if (!canTrigger(await roleOf(caller), kind)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Await inline: en Vercel Hobby las funciones se matan al responder, así que el
  // patrón "void runSync()" no es confiable. El cliente espera el resultado de
  // este segmento y, si es full y `done:false`, vuelve a llamar.
  const result = await runSync(kind);
  if (!result.ok) {
    const status = result.reason === "locked" ? 409 : 500;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const caller = await identify(req);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Cancelar aborta lo que esté corriendo, así que el permiso lo define el sync en
  // curso: un viewer frena su incremental, pero no el full de un admin.
  const status = await getStatus();
  const runningKind = status.state === "running" ? status.kind : null;
  if (!canCancel(await roleOf(caller), runningKind)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await requestCancel();
  return NextResponse.json({ cancelling: true });
}
