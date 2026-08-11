// Reglas de autorización por rol. Puras y sin nada de Next adentro, por el mismo
// motivo que google-oauth.ts: `cookies()` lanza fuera de un request, así que si la
// decisión viviera dentro de la route handler se quedaría sin tests. La handler
// sólo traduce HTTP ↔ estas funciones.
import type { SyncKind } from "@/lib/types";

export type Role = "admin" | "viewer";

/** Los emails se guardan y se comparan en minúsculas: `Pablo@` y `pablo@` son la
 *  misma persona, y dos filas harían que una promoción a admin no surtiera efecto
 *  al volver a entrar con la otra grafía. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Sin fila en `users` no hay rol. La conversión tiene nombre propio en vez de un
 *  `?? "viewer"` repetido en cada punto de uso, para que sea una decisión con test. */
export function roleOrDefault(role: Role | null | undefined): Role {
  return role ?? "viewer";
}

/** El incremental es libre; el full reconstruye el snapshot de ~21k filas y
 *  encadena invocaciones por minutos, así que es de admin. */
export function canTrigger(role: Role, kind: SyncKind): boolean {
  return kind === "incremental" || role === "admin";
}

/** Cancelar aborta lo que esté corriendo, sea de quien sea, así que el permiso lo
 *  define el sync en curso y no quién lo lanzó. `null` = nada corriendo: el DELETE
 *  es un no-op y no hay motivo para prohibirlo. */
export function canCancel(role: Role, runningKind: SyncKind | null): boolean {
  return runningKind !== "full" || role === "admin";
}
