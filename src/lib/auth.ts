// Única definición de sesión: src/lib/session.ts. Este archivo sólo re-exporta
// para que los consumidores viejos no cambien de import. Antes agregaba
// verifyPassword (bcrypt); el login pasó a Google (ADR-0008) y no queda password.
export { sessionOptions, type SessionData, type SessionUser } from "./session";
