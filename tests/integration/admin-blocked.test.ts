// POST /api/admin/blocked: bloquear por adelantado, haya entrado esa persona o no.
// Se ejerce la route handler real —no sólo las reglas puras— por el mismo motivo
// que admin-users: el bug que importa es olvidarse de conectar la regla.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { __setStore, setUserRole, recordLogin, isBlocked, listBlocked, listUsers, getUserRole } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";

const h = vi.hoisted(() => ({
  sesion: {} as { authenticated?: true; user?: { email: string; name: string } },
}));
vi.mock("iron-session", () => ({ getIronSession: async () => h.sesion }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

const { POST } = await import("@/app/api/admin/blocked/route");

const bloquear = (body: unknown) =>
  POST(new NextRequest(new Request("http://x/api/admin/blocked", {
    method: "POST",
    body: JSON.stringify(body),
  })));

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
  it("sin sesión: 403 y no se bloquea a nadie", async () => {
    expect((await bloquear({ emails: ["nuevo@hiuman.edu.mx"] })).status).toBe(403);
    expect(await isBlocked("nuevo@hiuman.edu.mx")).toBe(false);
  });

  it("viewer: 403", async () => {
    h.sesion = { authenticated: true, user: { email: OTRO, name: "Otro" } };
    expect((await bloquear({ emails: ["nuevo@hiuman.edu.mx"] })).status).toBe(403);
    expect(await isBlocked("nuevo@hiuman.edu.mx")).toBe(false);
  });
});

describe("bloqueo previo", () => {
  // El motivo de todo el endpoint: cerrar la puerta ANTES del primer ingreso.
  it("bloquea a quien nunca entró, sin fila en users", async () => {
    comoAdmin();
    const res = await bloquear({ emails: ["nuevo@hiuman.edu.mx"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, blocked: 1 });
    expect(await isBlocked("nuevo@hiuman.edu.mx")).toBe(true);
    // Sin nombre: no hay de dónde sacarlo, y la lista muestra el correo.
    expect((await listBlocked())[0]).toMatchObject({ email: "nuevo@hiuman.edu.mx", name: null, blockedBy: ADMIN });
  });

  it("varios de una", async () => {
    comoAdmin();
    const res = await bloquear({ emails: ["a@hiuman.edu.mx", "b@hiuman.edu.mx", "c@hiuman.edu.mx"] });
    expect((await res.json()).blocked).toBe(3);
    expect(await listBlocked()).toHaveLength(3);
  });

  it("normaliza y deduplica: dos grafías del mismo correo son una fila", async () => {
    comoAdmin();
    const res = await bloquear({ emails: ["Nuevo@Hiuman.edu.mx", " nuevo@hiuman.edu.mx "] });
    expect((await res.json()).blocked).toBe(1);
    expect(await listBlocked()).toHaveLength(1);
    expect(await isBlocked("NUEVO@hiuman.edu.mx")).toBe(true);
  });

  // Si ya tenía fila, tiene que quedar en UNA lista y no en las dos a la vez.
  it("a quien ya había entrado le copia el nombre y le borra la fila de users", async () => {
    comoAdmin();
    expect((await bloquear({ emails: [OTRO] })).status).toBe(200);
    expect((await listBlocked())[0]).toMatchObject({ email: OTRO, name: "Otro", blockedBy: ADMIN });
    expect((await listUsers()).map((u) => u.email)).toEqual([ADMIN]);
  });

  it("repetir un bloqueo no falla ni duplica", async () => {
    comoAdmin();
    await bloquear({ emails: ["nuevo@hiuman.edu.mx"] });
    expect((await bloquear({ emails: ["nuevo@hiuman.edu.mx"] })).status).toBe(200);
    expect(await listBlocked()).toHaveLength(1);
  });
});

describe("validación", () => {
  it("un correo con typo: 400 bad_email y NO se escribe nada del lote", async () => {
    comoAdmin();
    const res = await bloquear({ emails: ["bueno@hiuman.edu.mx", "sin-arroba"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_email", invalid: ["sin-arroba"] });
    // Lo importante: el lote es todo o nada. Un typo no debe dejar medio aplicado
    // algo que nadie puede ver a medias.
    expect(await isBlocked("bueno@hiuman.edu.mx")).toBe(false);
  });

  it("sin emails, lista vacía o con algo que no es texto: 400", async () => {
    comoAdmin();
    expect((await bloquear({})).status).toBe(400);
    expect((await bloquear({ emails: [] })).status).toBe(400);
    expect((await bloquear({ emails: [123] })).status).toBe(400);
    expect((await bloquear({ emails: ["  "] })).status).toBe(400);
  });

  it("más de 50: 400 too_many", async () => {
    comoAdmin();
    const muchos = Array.from({ length: 51 }, (_, i) => `p${i}@hiuman.edu.mx`);
    const res = await bloquear({ emails: muchos });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_many", max: 50 });
    expect(await listBlocked()).toHaveLength(0);
  });

  // La regla de la que sale que nunca queden cero admins.
  it("incluirse a uno mismo: 409 y no se bloquea NADIE del lote", async () => {
    comoAdmin();
    const res = await bloquear({ emails: ["nuevo@hiuman.edu.mx", "JEFA@hiuman.edu.mx"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "self" });
    expect(await isBlocked(ADMIN)).toBe(false);
    expect(await isBlocked("nuevo@hiuman.edu.mx")).toBe(false);
    expect(await getUserRole(ADMIN)).toBe("admin");
  });
});
