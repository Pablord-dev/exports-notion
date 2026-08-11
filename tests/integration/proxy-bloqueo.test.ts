// El proxy es lo que CIERRA una sesión ya emitida. La cookie está sellada y dura
// 7 días: sin este chequeo, quitarle el acceso a alguien no tendría efecto hasta
// que venciera. Se ejerce el proxy real y no la regla suelta, porque el bug que
// importa es olvidarse de conectarlo.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { __setStore, blockUser } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";

const h = vi.hoisted(() => ({
  sesion: {} as { authenticated?: true; user?: { email: string; name: string } },
}));
vi.mock("iron-session", () => ({ getIronSession: async () => h.sesion }));

const { proxy } = await import("@/proxy");

const VIVA = { authenticated: true as const, user: { email: "alguien@hiuman.edu.mx", name: "Alguien" } };
const pedir = (path: string) => proxy(new NextRequest(new Request(`http://x${path}`)));

beforeEach(() => {
  __setStore(newMemoryStore());
  h.sesion = {};
});

describe("proxy · rutas protegidas", () => {
  it("sin sesión: 401", async () => {
    expect((await pedir("/api/reports/by-person")).status).toBe(401);
  });

  it("con sesión viva y sin bloqueo: pasa", async () => {
    h.sesion = VIVA;
    expect((await pedir("/api/reports/by-person")).status).toBe(200);
  });

  it("bloqueado: 401 aunque la cookie siga siendo válida", async () => {
    h.sesion = VIVA;
    await blockUser("alguien@hiuman.edu.mx", "Alguien", "jefa@hiuman.edu.mx");
    const res = await pedir("/api/reports/by-person");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("el bloqueo alcanza a todas las rutas protegidas, no sólo a una", async () => {
    h.sesion = VIVA;
    await blockUser("alguien@hiuman.edu.mx", null, null);
    for (const p of ["/api/export", "/api/sync/status", "/api/chat", "/api/admin/users"]) {
      expect((await pedir(p)).status, p).toBe(401);
    }
  });

  it("bloquear a otra persona no toca esta sesión", async () => {
    h.sesion = VIVA;
    await blockUser("otro@hiuman.edu.mx", null, null);
    expect((await pedir("/api/reports/by-person")).status).toBe(200);
  });

  // Cookie previa a ADR-0008: sin correo no hay a quién buscar en la lista. Pasa
  // el proxy —la sesión es válida— y su rol cae a viewer más adelante.
  it("una sesión sin email pasa sin consultar la lista", async () => {
    h.sesion = { authenticated: true };
    const store = newMemoryStore();
    store.isBlocked = async () => { throw new Error("no debería consultarse"); };
    __setStore(store);
    expect((await pedir("/api/reports/by-person")).status).toBe(200);
  });

  // Fail-closed: si no se puede saber si está bloqueado, no pasa. Es un gate, no
  // un adorno — al revés que el rol de /api/sync/status, que sí se degrada.
  it("si la lista no se puede leer, corta con 503 en vez de dejar pasar", async () => {
    h.sesion = VIVA;
    const store = newMemoryStore();
    store.isBlocked = async () => { throw new Error('relation "blocked_users" does not exist'); };
    __setStore(store);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await pedir("/api/reports/by-person");
    expect(res.status).toBe(503);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("proxy · rutas fuera del matcher", () => {
  it("una ruta no protegida no consulta la lista siquiera", async () => {
    h.sesion = VIVA;
    const store = newMemoryStore();
    store.isBlocked = async () => { throw new Error("no debería consultarse"); };
    __setStore(store);
    expect((await pedir("/api/auth/session")).status).toBe(200);
  });
});
