import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { getStatus, getMeta, getUserRole } from "@/lib/db";
import { canCancel, canTrigger, roleOrDefault, type Role } from "@/lib/authz";
import { nextRun, cronSchedule } from "@/lib/cron";

export const dynamic = "force-dynamic";

const CRON_INCREMENTAL = cronSchedule("incremental");
const CRON_FULL = cronSchedule("full");

/** El rol es un adorno de este payload: el estado del snapshot no depende de él.
 *  Si el lookup falla, cae a `viewer` en vez de tumbar la respuesta entera —el
 *  modal de sync quedaría en blanco por una tabla ausente— y el default va hacia
 *  el lado seguro: veda el full, no lo habilita. */
async function roleFor(email: string | undefined): Promise<Role> {
  if (!email) return "viewer";
  try {
    return roleOrDefault(await getUserRole(email));
  } catch (e) {
    console.error("[auth] no se pudo leer el rol", e);
    return "viewer";
  }
}

export async function GET() {
  const now = new Date();
  const [status, meta] = await Promise.all([getStatus(), getMeta()]);

  // El permiso viaja con el estado y no por /api/auth/session, por una razón
  // estructural: quien consulta la sesión es AppShell, que es HIJO de la página,
  // así que un rol traído por el shell no llega al modal de sync. La página ya
  // polea este endpoint (2s corriendo, 30s en reposo), y el rol es un lookup por
  // clave primaria sobre una tabla de decenas de filas.
  // Esta ruta está en el matcher de proxy.ts, así que acá siempre hay sesión.
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const role = await roleFor(session.user?.email);
  const runningKind = status.state === "running" ? status.kind : null;

  return NextResponse.json({
    status, meta,
    // null = ese kind no está croneado (se dispara sólo a mano desde la UI).
    next: {
      incremental: CRON_INCREMENTAL ? nextRun(CRON_INCREMENTAL, now).toISOString() : null,
      full: CRON_FULL ? nextRun(CRON_FULL, now).toISOString() : null,
    },
    // La UI no interpreta roles: obedece estos booleanos.
    perms: {
      full: canTrigger(role, "full"),
      cancel: canCancel(role, runningKind),
    },
  });
}
