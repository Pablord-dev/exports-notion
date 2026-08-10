import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { resolveCallback, TX_COOKIE, type CallbackEnv } from "@/lib/google-oauth";
import { rateLimitLogin, recordLogin } from "@/lib/db";

export async function GET(req: NextRequest) {
  // ⚠️ Dos orígenes distintos a propósito, y confundirlos rompe cosas:
  //   · APP_ORIGIN va al redirect_uri, porque tiene que coincidir carácter por
  //     carácter con el registrado en Google.
  //   · Los redirects a NUESTRAS páginas van contra el origin del request. En el
  //     E2E el server corre en :3100 pero `next start` pisa el env heredado con
  //     .env.local, donde APP_ORIGIN dice :3000 — usarlo aquí mandaría a
  //     Playwright a otro server. Y en un preview de Vercel, a otro dominio.
  const appOrigin = process.env.APP_ORIGIN!;
  const here = req.nextUrl.origin;
  const jar = await cookies();

  // Un solo lugar para salir mal: borra siempre la cookie de transacción, así un
  // intento fallido no deja un state reutilizable dando vueltas.
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/?error=${code}`, here));
    res.cookies.delete(TX_COOKIE);
    return res;
  };

  const env: CallbackEnv = {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    sessionSecret: process.env.SESSION_SECRET!,
    origin: appOrigin,
    allowedDomains: process.env.ALLOWED_EMAIL_DOMAINS!,
  };

  // Cada canje hace que NUESTRA función salga a hablar con Google; sin tope es
  // un grifo abierto de invocaciones. Reusa la tabla login_attempts. El gate va
  // dentro de resolveCallback, después de las validaciones puras: cancelar en
  // Google o un probe sin cookie válida no consumen la ventana. Los logins
  // exitosos SÍ cuentan (no se sabe el resultado antes de canjear): 5/15min por
  // IP compartida —oficina tras un NAT— puede morder si todos entran a la vez.
  // E2E_STUBS comparte el bucket "unknown" entre workers, mismo motivo que
  // tenía /api/login.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const q = req.nextUrl.searchParams;
  const r = await resolveCallback({
    code: q.get("code"),
    state: q.get("state"),
    googleError: q.get("error"),
    sealedTx: jar.get(TX_COOKIE)?.value,
    env,
    nowMs: Date.now(),
    beforeExchange: async () => process.env.E2E_STUBS === "1" || rateLimitLogin(ip),
  });
  if (!r.ok) return fail(r.failure);

  // Alta o refresco en `users`. Va ANTES de sellar la sesión: si la base no
  // responde, es preferible no emitir una cookie de 7 días para alguien que no
  // quedó registrado. No agrega un modo de falla nuevo — rateLimitLogin, unas
  // líneas arriba, ya depende de la misma base.
  await recordLogin(r.identity.email, r.identity.name);

  const session = await getIronSession<SessionData>(jar, sessionOptions);
  session.authenticated = true;
  session.user = r.identity;
  await session.save();

  const res = NextResponse.redirect(new URL("/?bienvenida=1", here));
  res.cookies.delete(TX_COOKIE);
  return res;
}
