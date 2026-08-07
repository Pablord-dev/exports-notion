// Login con Google: OAuth 2.0 Authorization Code + PKCE, escrito a mano sobre la
// iron-session que ya usa la app (ADR-0008). Este módulo NO importa nada de Next
// a propósito: así se testea suelto y las route handlers quedan de diez líneas.

import { createHash, randomBytes } from "node:crypto";
import { sealData, unsealData } from "iron-session";

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

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type TokenFetcher = (url: string, init: RequestInit) => Promise<Response>;
const realFetcher: TokenFetcher = (url, init) => fetch(url, init);
let tokenFetcher: TokenFetcher = realFetcher;

/** Costura de tests, mismo patrón que __setLlmClient / __setStore: inyectar un
 *  doble en vez de mockear módulos globalmente. */
export function __setTokenFetcher(f: TokenFetcher): void {
  tokenFetcher = f;
}
export function __resetTokenFetcher(): void {
  tokenFetcher = realFetcher;
}

/**
 * Canjea el `code` por tokens. Devuelve un resultado, nunca lanza: para el
 * callback cualquier fallo aquí es el mismo error de cara al usuario, y una
 * excepción sin atrapar convertiría un login fallido en un 500.
 */
export async function exchangeCode(p: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ ok: true; idToken: string } | { ok: false }> {
  const body = new URLSearchParams({
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
    grant_type: "authorization_code",
    code_verifier: p.codeVerifier,
  });
  try {
    const r = await tokenFetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!r.ok) return { ok: false };
    const j = (await r.json()) as { id_token?: unknown };
    if (typeof j?.id_token !== "string" || !j.id_token) return { ok: false };
    return { ok: true, idToken: j.id_token };
  } catch {
    return { ok: false };
  }
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

/** Cookie de la transacción en curso: state + code_verifier, cifrados. Vive 10
 *  minutos porque es el tiempo de una vuelta a Google, no una sesión. */
export const TX_COOKIE = "oauth-tx";
export const TX_TTL_SEC = 600;

export interface OAuthTx {
  state: string;
  verifier: string;
}

export async function sealTx(tx: OAuthTx, password: string): Promise<string> {
  return sealData(tx, { password, ttl: TX_TTL_SEC });
}

/** Devuelve null en vez de lanzar: una cookie vencida, manipulada o ausente son
 *  el mismo caso para quien llama —transacción inválida—. */
export async function openTx(sealed: string, password: string): Promise<OAuthTx | null> {
  try {
    const tx = await unsealData<OAuthTx>(sealed, { password, ttl: TX_TTL_SEC });
    if (!tx || typeof tx.state !== "string" || typeof tx.verifier !== "string") return null;
    if (!tx.state || !tx.verifier) return null;
    return tx;
  } catch {
    return null;
  }
}

export interface CallbackEnv {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  origin: string;
  /** ALLOWED_EMAIL_DOMAINS crudo; se parsea aquí. */
  allowedDomains: string;
}

export type CallbackFailure = "state" | "google" | "token" | "unverified" | "domain" | "rate";

/**
 * Decide si alguien entra. Puro a propósito: recibe la cookie sellada como
 * string en vez de leerla de `cookies()`, porque esa API de Next lanza fuera de
 * un request y la orquestación quedaría sin tests. La route handler sólo traduce
 * HTTP ↔ esta función.
 */
export async function resolveCallback(input: {
  code: string | null;
  state: string | null;
  googleError: string | null;
  sealedTx: string | undefined;
  env: CallbackEnv;
  nowMs: number;
  /** Gate previo al canje (el rate-limit en producción). Corre DESPUÉS de las
   *  validaciones puras: cancelar en Google o mandar un state forjado no debe
   *  consumir la ventana — lo único que el límite protege es la salida a
   *  hablar con Google. false = negado → failure "rate". */
  beforeExchange?: () => Promise<boolean>;
}): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; failure: CallbackFailure }> {
  // El usuario canceló en la pantalla de Google, o Google rechazó la petición.
  if (input.googleError) return { ok: false, failure: "google" };
  if (!input.code || !input.state || !input.sealedTx) return { ok: false, failure: "state" };

  const tx = await openTx(input.sealedTx, input.env.sessionSecret);
  // El state se compara ANTES de canjear: sin esto, un code inyectado por un
  // tercero se cambiaría por una sesión.
  if (!tx || tx.state !== input.state) return { ok: false, failure: "state" };

  if (input.beforeExchange && !(await input.beforeExchange())) {
    return { ok: false, failure: "rate" };
  }

  const redirectUri = callbackUrl(input.env.origin);
  const ex = await exchangeCode({
    code: input.code,
    codeVerifier: tx.verifier,
    redirectUri,
    clientId: input.env.clientId,
    clientSecret: input.env.clientSecret,
  });
  if (!ex.ok) return { ok: false, failure: "token" };

  const read = readIdToken(ex.idToken, { clientId: input.env.clientId, nowMs: input.nowMs });
  if (!read.ok) {
    // "unverified" es el único problema del token que se le explica al usuario:
    // es el único que puede resolver él. El resto es un fallo nuestro o un ataque.
    return { ok: false, failure: read.problem === "unverified" ? "unverified" : "token" };
  }

  if (!isAllowedEmail(read.identity.email, parseAllowedDomains(input.env.allowedDomains))) {
    return { ok: false, failure: "domain" };
  }
  return { ok: true, identity: read.identity };
}
