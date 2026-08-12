import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { isBlocked } from "@/lib/db";

const PROTECTED = ["/api/export", "/api/sync/status", "/api/reports", "/api/chat", "/api/admin"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /api/sync acepta cookie de usuario O Bearer del cron — manejado en la route.
  if (!PROTECTED.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const res = NextResponse.next();
  // @ts-expect-error iron-session typing
  const session = await getIronSession<SessionData>(req.cookies, sessionOptions);
  if (!session.authenticated) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Acá es donde se cierra una sesión ya emitida. La cookie está sellada y vive 7
  // días: el server no lleva registro de qué sesiones existen, así que sin este
  // chequeo quitarle el acceso a alguien no surtiría efecto hasta que venciera.
  // Va en el proxy y no en cada route handler porque es el único punto por el que
  // pasan export, reportes, chat y administración — una ruta nueva queda cubierta
  // sola. Cuesta un lookup por clave primaria sobre una tabla de pocas filas.
  // Una sesión sin correo (cookie previa a ADR-0008) no tiene a quién buscar.
  const email = session.user?.email;
  if (email) {
    try {
      if (await isBlocked(email)) {
        // La cookie se borra además de responder 401: si no, cada request
        // siguiente vuelve a pagar el lookup para llegar al mismo lugar.
        const out = NextResponse.json({ error: "unauthorized" }, { status: 401 });
        out.cookies.delete(sessionOptions.cookieName);
        return out;
      }
    } catch (e) {
      // ⚠️ Fail-closed, al revés que el rol de /api/sync/status: esto decide un
      // acceso, y tragarse el error dejaría entrar justo a quien se quiso sacar.
      // 503 y no 500 porque es indisponibilidad, no un bug de la petición.
      console.error("[auth] no se pudo verificar la lista de bloqueo", e);
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
  }
  return res;
}

export const config = {
  matcher: ["/api/export/:path*", "/api/sync/status", "/api/reports/:path*", "/api/chat", "/api/chat/:path*", "/api/admin/:path*"],
};
