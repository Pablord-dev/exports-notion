// El shell decide con esto si dibuja la sección Usuarios, así que el rol tiene
// que viajar en la respuesta de la sesión — leído de la tabla, no de la cookie.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __setStore, setUserRole, recordLogin, blockUser } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";

const h = vi.hoisted(() => ({
  sesion: {} as { authenticated?: true; user?: { email: string; name: string } },
}));
vi.mock("iron-session", () => ({ getIronSession: async () => h.sesion }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

const { GET } = await import("@/app/api/auth/session/route");
const get = async () => (await GET()).json();

beforeEach(() => {
  __setStore(newMemoryStore());
  h.sesion = {};
});

describe("GET /api/auth/session", () => {
  it("sin sesión no toca la base ni inventa rol", async () => {
    const store = newMemoryStore();
    store.getUserRole = async () => { throw new Error("no debería consultarse"); };
    __setStore(store);
    expect(await get()).toEqual({ authenticated: false });
  });

  it("con fila admin devuelve admin", async () => {
    await setUserRole("jefa@hiuman.edu.mx", "admin");
    h.sesion = { authenticated: true, user: { email: "jefa@hiuman.edu.mx", name: "Jefa" } };
    expect((await get()).role).toBe("admin");
  });

  it("sin fila cae a viewer", async () => {
    h.sesion = { authenticated: true, user: { email: "nadie@hiuman.edu.mx", name: "Nadie" } };
    expect((await get()).role).toBe("viewer");
  });

  // Esta ruta está FUERA del matcher del proxy, así que el bloqueo lo tiene que
  // mirar ella misma. Es lo que el shell polea para expulsar a quien perdió el
  // acceso mientras tenía una pantalla abierta.
  it("a quien perdió el acceso le responde que no hay sesión", async () => {
    await recordLogin("fuera@hiuman.edu.mx", "Fuera");
    await blockUser("fuera@hiuman.edu.mx", "Fuera", "jefa@hiuman.edu.mx");
    h.sesion = { authenticated: true, user: { email: "fuera@hiuman.edu.mx", name: "Fuera" } };
    expect(await get()).toEqual({ authenticated: false });
  });

  // Fail-closed también acá: si no se puede saber, se lo trata como afuera. Es
  // lo contrario del rol, que sí se degrada — el rol pinta, esto expulsa.
  it("si la lista de bloqueo no se puede leer, tampoco hay sesión", async () => {
    const store = newMemoryStore();
    store.isBlocked = async () => { throw new Error("base caída"); };
    __setStore(store);
    h.sesion = { authenticated: true, user: { email: "jefa@hiuman.edu.mx", name: "Jefa" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await get()).toEqual({ authenticated: false });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  // Este rol sólo pinta UI: el gate real vive en /api/admin/users. Una tabla
  // caída no puede dejar el shell sin footer, y el default va al lado seguro.
  it("si el lookup falla, responde igual y cae a viewer", async () => {
    await recordLogin("jefa@hiuman.edu.mx", "Jefa");
    const store = newMemoryStore();
    store.getUserRole = async () => { throw new Error('relation "users" does not exist'); };
    __setStore(store);
    h.sesion = { authenticated: true, user: { email: "jefa@hiuman.edu.mx", name: "Jefa" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await get();
    expect(body.authenticated).toBe(true);
    expect(body.role).toBe("viewer");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
