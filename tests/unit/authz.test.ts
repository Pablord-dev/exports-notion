import { describe, it, expect } from "vitest";
import { normalizeEmail, roleOrDefault, canTrigger, canCancel, canManageUsers, canEditUser } from "@/lib/authz";

describe("normalizeEmail", () => {
  it("baja a minúsculas y recorta espacios", () => {
    expect(normalizeEmail("  Pablo.Sanchez@Hiuman.EDU.mx ")).toBe("pablo.sanchez@hiuman.edu.mx");
  });
  it("un email ya normalizado queda igual", () => {
    expect(normalizeEmail("a@b.mx")).toBe("a@b.mx");
  });
});

describe("roleOrDefault", () => {
  // Sin fila en `users` no hay rol: el default seguro es el que menos puede.
  it("null y undefined caen a viewer", () => {
    expect(roleOrDefault(null)).toBe("viewer");
    expect(roleOrDefault(undefined)).toBe("viewer");
  });
  it("un rol existente no se pisa", () => {
    expect(roleOrDefault("admin")).toBe("admin");
    expect(roleOrDefault("viewer")).toBe("viewer");
  });
});

describe("canTrigger", () => {
  it("el incremental es libre para cualquiera", () => {
    expect(canTrigger("viewer", "incremental")).toBe(true);
    expect(canTrigger("admin", "incremental")).toBe(true);
  });
  it("el full es sólo de admin", () => {
    expect(canTrigger("viewer", "full")).toBe(false);
    expect(canTrigger("admin", "full")).toBe(true);
  });
});

describe("canCancel", () => {
  // El permiso lo define lo que está corriendo, no quién lo lanzó: un viewer
  // frena su propio incremental pero no puede tirar abajo el full de un admin.
  it("con un incremental corriendo cancela cualquiera", () => {
    expect(canCancel("viewer", "incremental")).toBe(true);
    expect(canCancel("admin", "incremental")).toBe(true);
  });
  it("con un full corriendo sólo cancela un admin", () => {
    expect(canCancel("viewer", "full")).toBe(false);
    expect(canCancel("admin", "full")).toBe(true);
  });
  it("sin nada corriendo cancela cualquiera (el DELETE es un no-op)", () => {
    expect(canCancel("viewer", null)).toBe(true);
    expect(canCancel("admin", null)).toBe(true);
  });
});

describe("canManageUsers", () => {
  it("administrar usuarios es de admin", () => {
    expect(canManageUsers("admin")).toBe(true);
    expect(canManageUsers("viewer")).toBe(false);
  });
});

describe("canEditUser", () => {
  it("sobre otra persona se puede", () => {
    expect(canEditUser("a@hiuman.edu.mx", "b@hiuman.edu.mx")).toBe(true);
  });
  // Nadie se degrada ni se borra a sí mismo. De ahí sale, gratis, que nunca
  // pueda quedar la app sin ningún admin: quien administra siempre sobrevive.
  it("sobre uno mismo no", () => {
    expect(canEditUser("a@hiuman.edu.mx", "a@hiuman.edu.mx")).toBe(false);
  });
  // Sin normalizar, un admin se degradaría escribiendo su correo en mayúsculas.
  it("tampoco con otra grafía del mismo correo", () => {
    expect(canEditUser("Pablo@Hiuman.edu.mx", " pablo@hiuman.edu.mx ")).toBe(false);
  });
});
