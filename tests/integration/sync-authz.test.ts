// El gate de /api/sync a nivel route handler: quién puede disparar qué.
// Se ejerce la handler real (no sólo las reglas puras) porque el bug que importa
// es olvidarse de conectar la regla, no equivocarse en la tabla de verdad.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { __setStore, setUserRole, setStatus } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";

// La sesión se inyecta por mock de iron-session: `cookies()` necesita un request
// real de Next y acá lo que se prueba es la decisión, no el sellado de la cookie.
// vi.hoisted es obligatorio: el factory de vi.mock se iza por encima de las
// declaraciones del archivo, así que un `let sesion` suelto quedaría en zona
// muerta temporal y el mock reventaría al construirse.
const h = vi.hoisted(() => ({
  sesion: {} as { authenticated?: true; user?: { email: string; name: string } },
}));
vi.mock("iron-session", () => ({ getIronSession: async () => h.sesion }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

// runSync no se ejerce acá: esta suite prueba el permiso, no el sync. Devuelve el
// resultado feliz para que un 200 signifique "pasó el gate".
vi.mock("@/lib/sync", () => ({
  runSync: vi.fn(async () => ({ ok: true, done: true, upserted: 0, deleted: 0 })),
}));

const { POST, DELETE } = await import("@/app/api/sync/route");

const req = (url: string, init?: RequestInit) => new NextRequest(new Request(url, init));
const post = (kind: string, init?: RequestInit) => POST(req(`http://x/api/sync?kind=${kind}`, { method: "POST", ...init }));

beforeEach(async () => {
  __setStore(newMemoryStore());
  process.env.CRON_SECRET = "secreto-del-cron";
  h.sesion = {};
});

describe("POST /api/sync", () => {
  it("sin sesión ni bearer: 401", async () => {
    expect((await post("full")).status).toBe(401);
  });

  it("viewer: el incremental pasa", async () => {
    h.sesion = { authenticated: true, user: { email: "v@hiuman.edu.mx", name: "V" } };
    expect((await post("incremental")).status).toBe(200);
  });

  it("viewer: el full se rechaza con 403 forbidden", async () => {
    h.sesion = { authenticated: true, user: { email: "v@hiuman.edu.mx", name: "V" } };
    const res = await post("full");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("admin: el full pasa", async () => {
    await setUserRole("a@hiuman.edu.mx", "admin");
    h.sesion = { authenticated: true, user: { email: "a@hiuman.edu.mx", name: "A" } };
    expect((await post("full")).status).toBe(200);
  });

  it("el bearer del cron puede con ambos sin tener fila en users", async () => {
    const auth = { headers: { authorization: "Bearer secreto-del-cron" } };
    expect((await post("incremental", auth)).status).toBe(200);
    expect((await post("full", auth)).status).toBe(200);
  });

  it("una sesión sin email (cookie previa a ADR-0008) cae a viewer", async () => {
    h.sesion = { authenticated: true };
    expect((await post("full")).status).toBe(403);
    expect((await post("incremental")).status).toBe(200);
  });

  it("un kind inválido es 400 aunque el rol alcance", async () => {
    await setUserRole("a@hiuman.edu.mx", "admin");
    h.sesion = { authenticated: true, user: { email: "a@hiuman.edu.mx", name: "A" } };
    expect((await post("parcial")).status).toBe(400);
  });
});

describe("DELETE /api/sync", () => {
  const corriendo = (kind: "incremental" | "full") =>
    setStatus({ state: "running", kind, done: 0, total: 0, startedAt: null, error: null, skipped: 0 });
  const del = () => DELETE(req("http://x/api/sync", { method: "DELETE" }));

  it("viewer con un incremental corriendo: cancela", async () => {
    h.sesion = { authenticated: true, user: { email: "v@hiuman.edu.mx", name: "V" } };
    await corriendo("incremental");
    expect((await del()).status).toBe(200);
  });

  it("viewer con un full corriendo: 403", async () => {
    h.sesion = { authenticated: true, user: { email: "v@hiuman.edu.mx", name: "V" } };
    await corriendo("full");
    expect((await del()).status).toBe(403);
  });

  it("admin con un full corriendo: cancela", async () => {
    await setUserRole("a@hiuman.edu.mx", "admin");
    h.sesion = { authenticated: true, user: { email: "a@hiuman.edu.mx", name: "A" } };
    await corriendo("full");
    expect((await del()).status).toBe(200);
  });

  it("sin nada corriendo cancela cualquiera (no-op)", async () => {
    h.sesion = { authenticated: true, user: { email: "v@hiuman.edu.mx", name: "V" } };
    expect((await del()).status).toBe(200);
  });
});

describe("GET /api/sync/status: perms", () => {
  // Import diferido: comparte los mocks de iron-session/next-headers de arriba.
  const get = async () => {
    const { GET } = await import("@/app/api/sync/status/route");
    return (await GET()).json();
  };
  const corriendo = (kind: "incremental" | "full") =>
    setStatus({ state: "running", kind, done: 0, total: 0, startedAt: null, error: null, skipped: 0 });

  it("viewer: no puede full, sí cancelar cuando no corre nada", async () => {
    h.sesion = { authenticated: true, user: { email: "v@hiuman.edu.mx", name: "V" } };
    expect((await get()).perms).toEqual({ full: false, cancel: true });
  });

  it("viewer con un full corriendo: tampoco puede cancelar", async () => {
    h.sesion = { authenticated: true, user: { email: "v@hiuman.edu.mx", name: "V" } };
    await corriendo("full");
    expect((await get()).perms).toEqual({ full: false, cancel: false });
  });

  it("admin: puede con todo", async () => {
    await setUserRole("a@hiuman.edu.mx", "admin");
    h.sesion = { authenticated: true, user: { email: "a@hiuman.edu.mx", name: "A" } };
    await corriendo("full");
    expect((await get()).perms).toEqual({ full: true, cancel: true });
  });

  // El resto del payload no depende del rol: un lookup roto no puede dejar el
  // modal de sync en blanco (con la tabla ausente, este endpoint daba 500).
  it("si el lookup del rol falla, el estado igual responde y veda el full", async () => {
    const store = newMemoryStore();
    store.getUserRole = async () => { throw new Error('relation "users" does not exist'); };
    __setStore(store);
    h.sesion = { authenticated: true, user: { email: "a@hiuman.edu.mx", name: "A" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await get();
    expect(body.status.state).toBe("idle");            // el estado llegó
    expect(body.perms).toEqual({ full: false, cancel: true }); // y vedó, no habilitó
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
