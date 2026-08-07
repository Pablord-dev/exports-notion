import type { SessionOptions } from "iron-session";

export interface SessionUser {
  email: string;
  name: string;
}

export interface SessionData {
  /** Se conserva tal cual: es la condición que evalúan proxy.ts y las rutas de
   *  API, y así el login con Google no las obliga a cambiar. La identidad se
   *  suma, no sustituye. */
  authenticated?: true;
  /** Ausente en cookies emitidas antes del login con Google (ADR-0008). */
  user?: SessionUser;
}

export const sessionOptions: SessionOptions = {
  // Sin fallback a propósito: instrumentation.ts valida SESSION_SECRET al boot
  // (fail-fast); si faltara, iron-session rechaza el password vacío en vez de
  // firmar cookies con un secreto conocido.
  password: process.env.SESSION_SECRET ?? "",
  cookieName: "export-notion-session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  },
};
