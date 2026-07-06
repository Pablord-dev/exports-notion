import type { SessionOptions } from "iron-session";

export interface SessionData {
  authenticated?: true;
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
