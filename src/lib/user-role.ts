// Lectura del rol para consumo DECORATIVO (pintar UI). Vive aparte porque la
// necesitan dos rutas y duplicarla haría que una se arregle y la otra no.
//
// ⚠️ No usar esto para autorizar: se traga el error y devuelve `viewer`. El gate
// de /api/admin/users y el de /api/sync leen getUserRole directo, sin catch, para
// que un fallo de base cierre la puerta en vez de abrirla.
import { getUserRole } from "@/lib/db";
import { roleOrDefault, type Role } from "@/lib/authz";

export async function safeRoleFor(email: string | undefined): Promise<Role> {
  if (!email) return "viewer";
  try {
    return roleOrDefault(await getUserRole(email));
  } catch (e) {
    console.error("[auth] no se pudo leer el rol", e);
    return "viewer";
  }
}
