// Login con Google: OAuth 2.0 Authorization Code + PKCE, escrito a mano sobre la
// iron-session que ya usa la app (ADR-0008). Este módulo NO importa nada de Next
// a propósito: así se testea suelto y las route handlers quedan de diez líneas.

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
