// Login con Google: OAuth 2.0 Authorization Code + PKCE, escrito a mano sobre la
// iron-session que ya usa la app (ADR-0008). Este módulo NO importa nada de Next
// a propósito: así se testea suelto y las route handlers quedan de diez líneas.

import { createHash, randomBytes } from "node:crypto";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** base64url para que entre en una URL sin escapes ni sorpresas de encoding. */
export function newState(): string {
  return randomBytes(32).toString("base64url");
}

/** PKCE S256. Con cliente confidencial es cinturón y tirantes, pero son seis
 *  líneas y cierra el robo del `code` en tránsito. */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url"); // 43 chars, el mínimo del RFC
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** El redirect_uri tiene que ser IDÉNTICO en la autorización y en el canje del
 *  code, o Google responde redirect_uri_mismatch. Una sola función para que las
 *  dos rutas no puedan divergir. */
export function callbackUrl(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

export function authorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    // Sin refresh token: no hay nada que guardar ni renovar.
    access_type: "online",
  });
  return `${AUTH_ENDPOINT}?${q}`;
}

/**
 * Lee ALLOWED_EMAIL_DOMAINS. Descarta entradas vacías para que una coma sobrante
 * ("a.com,") no registre un dominio fantasma que después acepte cualquier cosa.
 */
export function parseAllowedDomains(raw: string): string[] {
  return raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/**
 * Comparación EXACTA contra el dominio del correo: un comodín de subdominios es
 * la clase de laxitud que después nadie recuerda haber concedido. Lista vacía =
 * nadie entra, no "todos entran": si alguien borra la env var, el fallo es cerrado.
 */
export function isAllowedEmail(email: string, domains: string[]): boolean {
  if (domains.length === 0) return false;
  const at = email.indexOf("@");
  // Exactamente una @, y ni al principio ni al final.
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain) return false;
  return domains.includes(domain);
}
