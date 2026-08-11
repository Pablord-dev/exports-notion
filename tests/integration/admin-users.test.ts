// El gate de /api/admin/users a nivel route handler. Se ejerce la handler real
// —no sólo las reglas puras— porque el bug que importa es olvidarse de conectar
// la regla, no equivocarse en la tabla de verdad. Mismo molde que sync-authz.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { __setStore, setUserRole, recordLogin, getUserRole, listUsers } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";

// vi.hoisted es obligatorio: el factory de vi.mock se iza por encima de las
// declaraciones del archivo y un `let sesion` suelto quedaría en zona muerta.
const h = vi.hoisted(() => ({
  sesion: {} as { authenticated?: true; user?: { email: string; name: string } },
}));
vi.mock("iron-session", () => ({ getIronSession: async () => h.sesion }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

const { GET, PATCH, DELETE } = await import("@/app/api/admin/users/route");

const req = (url: string, init?: RequestInit) => new NextRequest(new Request(url, init));
const patch = (body: unknown) =>
  PATCH(req("http://x/api/admin/users", { method: "PATCH", body: JSON.stringify(body) }));
const del = (qs: string) => DELETE(req(`http://x/api/admin/users${qs}`, { method: "DELETE" }));

const ADMIN = "jefa@hiuman.edu.mx";
const OTRO = "otro@hiuman.edu.mx";
const comoAdmin = () => { h.sesion = { authenticated: true, user: { email: ADMIN, name: "Jefa" } }; };

beforeEach(async () => {
  __setStore(newMemoryStore());
  await setUserRole(ADMIN, "admin");
  await recordLogin(OTRO, "Otro");
  h.sesion = {};
});

describe("permisos", () => {
  it("sin sesión: 403", async () => {
    expect((await GET()).status).toBe(403);
  });

  it("viewer: 403 en los tres verbos", async () => {
    h.sesion = { authenticated: true, user: { email: OTRO, name: "Otro" } };
    expect((await GET()).status).toBe(403);
    expect((await patch({ email: ADMIN, role: "viewer" })).status).toBe(403);
    expect((await del(`?email=${ADMIN}`)).status).toBe(403);
    // Y no fue un 403 decorativo: nada cambió.
    expect(await getUserRole(ADMIN)).toBe("admin");
  });

  // Cookie previa a ADR-0008: sin email no hay a quién asignarle rol → viewer.
  it("una sesión sin email: 403", async () => {
    h.sesion = { authenticated: true };
    expect((await GET()).status).toBe(403);
  });
});

describe("GET", () => {
  it("admin: lista las filas", async () => {
    comoAdmin();
    const res = await GET();
    expect(res.status).toBe(200);
    const { users } = await res.json();
    expect(users.map((u: { email: string }) => u.email).sort()).toEqual([ADMIN, OTRO]);
  });
});

describe("PATCH", () => {
  it("admin: promueve a otra persona", async () => {
    comoAdmin();
    expect((await patch({ email: OTRO, role: "admin" })).status).toBe(200);
    expect(await getUserRole(OTRO)).toBe("admin");
  });

  // La regla que garantiza que nunca queden cero admins.
  it("sobre uno mismo: 409 y el rol queda intacto", async () => {
    comoAdmin();
    const res = await patch({ email: ADMIN, role: "viewer" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "self" });
    expect(await getUserRole(ADMIN)).toBe("admin");
  });

  it("con otra grafía del propio correo: también 409", async () => {
    comoAdmin();
    expect((await patch({ email: "JEFA@hiuman.edu.mx", role: "viewer" })).status).toBe(409);
  });

  it("un rol inventado: 400 bad_role", async () => {
    comoAdmin();
    const res = await patch({ email: OTRO, role: "superadmin" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_role" });
    expect(await getUserRole(OTRO)).toBe("viewer");
  });

  it("sin email: 400 bad_request", async () => {
    comoAdmin();
    expect((await patch({ role: "admin" })).status).toBe(400);
  });
});

describe("DELETE", () => {
  it("admin: borra la fila de otra persona", async () => {
    comoAdmin();
    expect((await del(`?email=${OTRO}`)).status).toBe(200);
    expect((await listUsers()).map((u) => u.email)).toEqual([ADMIN]);
  });

  it("sobre uno mismo: 409 y la fila sobrevive", async () => {
    comoAdmin();
    expect((await del(`?email=${ADMIN}`)).status).toBe(409);
    expect(await getUserRole(ADMIN)).toBe("admin");
  });

  it("sin email: 400", async () => {
    comoAdmin();
    expect((await del("")).status).toBe(400);
  });
});
