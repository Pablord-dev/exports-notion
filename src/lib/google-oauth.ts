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

/** Los dos valores de `iss` que Google emite. Validar sólo uno rechazaría
 *  logins legítimos. */
const GOOGLE_ISS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface GoogleIdentity {
  email: string;
  name: string;
}

export type IdTokenProblem = "malformed" | "aud" | "iss" | "expired" | "unverified";

/**
 * Lee el ID token SIN verificar su firma. Es deliberado y sólo vale porque el
 * token llega del canje directo con el endpoint de Google por TLS: el canal ya
 * autentica el origen, y la verificación de firma es para tokens que llegan de
 * terceros. ⚠️ Si algún día se acepta un id_token por otra vía, hay que verificar
 * la firma (JWKS) antes de confiar en estos claims.
 */
export function readIdToken(
  idToken: string,
  o: { clientId: string; nowMs: number },
): { ok: true; identity: GoogleIdentity } | { ok: false; problem: IdTokenProblem } {
  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, problem: "malformed" };

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, problem: "malformed" };
  }
  if (!claims || typeof claims !== "object") return { ok: false, problem: "malformed" };

  if (claims.aud !== o.clientId) return { ok: false, problem: "aud" };
  if (typeof claims.iss !== "string" || !GOOGLE_ISS.has(claims.iss)) return { ok: false, problem: "iss" };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= o.nowMs) return { ok: false, problem: "expired" };

  const email = claims.email;
  if (typeof email !== "string" || !email) return { ok: false, problem: "malformed" };

  // Explícito, nunca por truthiness: un claim ausente o con cualquier otro valor
  // es "no verificado". Sin esto, alguien podría declarar un correo del dominio
  // sin poseerlo.
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!verified) return { ok: false, problem: "unverified" };

  // Google no garantiza `name`. Sin fallback, la UI mostraría un hueco donde va
  // una persona.
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email;
  return { ok: true, identity: { email, name } };
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
