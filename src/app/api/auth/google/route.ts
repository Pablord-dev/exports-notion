import { NextResponse } from "next/server";
import { authorizeUrl, callbackUrl, newPkce, newState, sealTx, TX_COOKIE, TX_TTL_SEC } from "@/lib/google-oauth";

export async function GET() {
  const state = newState();
  const { verifier, challenge } = newPkce();
  const origin = process.env.APP_ORIGIN!;
  const sealed = await sealTx({ state, verifier }, process.env.SESSION_SECRET!);

  const res = NextResponse.redirect(authorizeUrl({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    redirectUri: callbackUrl(origin),
    state,
    codeChallenge: challenge,
  }));

  // sameSite "lax" es OBLIGATORIO aquí, no una preferencia: la vuelta desde
  // Google es una navegación de otro sitio, y con "strict" el navegador no
  // mandaría esta cookie y el callback vería una transacción inexistente.
  res.cookies.set(TX_COOKIE, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TX_TTL_SEC,
    path: "/",
  });
  return res;
}
