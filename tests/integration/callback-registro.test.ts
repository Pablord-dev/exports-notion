// El callback de Google da de alta al usuario. Se ejerce la route handler entera
// porque el bug que importa es olvidarse de llamar a recordLogin, no equivocarse
// en el SQL (eso lo cubre userCases).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { __setStore, getUserRole, setUserRole } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";

// vi.hoisted: el factory de vi.mock se iza por encima de las declaraciones del
// archivo, así que una variable suelta quedaría en zona muerta temporal.
const h = vi.hoisted(() => ({ guardada: null as unknown }));

vi.mock("iron-session", () => ({
  getIronSession: async () => ({ save: async () => { h.guardada = true; } }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "tx-sellada" }) }),
  headers: async () => new Headers(),
}));
// El canje con Google ya tiene sus propios tests en auth-google.test.ts: acá se
// da por bueno y lo que se observa es el efecto sobre `users`.
vi.mock("@/lib/google-oauth", async (real) => ({
  ...(await real<typeof import("@/lib/google-oauth")>()),
  resolveCallback: async () => ({
    ok: true as const,
    identity: { email: "Pablo@Hiuman.edu.mx", name: "Pablo Sánchez" },
  }),
}));

const { GET } = await import("@/app/api/auth/google/callback/route");
const llamar = () => GET(new NextRequest(new Request("http://x/api/auth/google/callback?code=c&state=s")));

beforeEach(() => {
  __setStore(newMemoryStore());
  process.env.APP_ORIGIN = "http://x";
  process.env.E2E_STUBS = "1"; // saltea el rate-limit, que no es lo que se prueba acá
  h.guardada = null;
});

describe("callback de Google", () => {
  it("un login exitoso deja la fila en users, con el email normalizado", async () => {
    const res = await llamar();
    expect(res.status).toBe(307); // redirect a /?bienvenida=1
    // La identidad venía con mayúsculas: si no se normalizara, esta consulta daría null.
    expect(await getUserRole("pablo@hiuman.edu.mx")).toBe("viewer");
  });

  it("el rol de un admin sobrevive a un login posterior", async () => {
    await setUserRole("pablo@hiuman.edu.mx", "admin");
    await llamar();
    expect(await getUserRole("pablo@hiuman.edu.mx")).toBe("admin");
  });

  // Registrar la visita no puede ser la puerta: la autenticación ya está resuelta
  // (dominio verificado) cuando se escribe la fila. Con la escritura bloqueante,
  // la tabla ausente dejó a TODOS afuera con un 500 (2026-08-10).
  it("si la base falla al registrar, el login entra igual", async () => {
    const store = newMemoryStore();
    store.recordLogin = async () => { throw new Error('relation "users" does not exist'); };
    __setStore(store);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await llamar();
    expect(res.status).toBe(307);       // redirect normal, no 500
    expect(h.guardada).toBe(true);      // y la sesión quedó sellada
    expect(err).toHaveBeenCalled();     // pero el fallo no pasa en silencio
    err.mockRestore();
  });

  // Quien no llegó a registrarse no tiene fila, y sin fila roleOrDefault da
  // viewer: el modo degradado da MENOS permisos, nunca más.
  it("el que entra sin quedar registrado cae a viewer", async () => {
    const store = newMemoryStore();
    store.recordLogin = async () => { throw new Error("base caída"); };
    __setStore(store);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await llamar();
    expect(await getUserRole("pablo@hiuman.edu.mx")).toBeNull();
    err.mockRestore();
  });
});
