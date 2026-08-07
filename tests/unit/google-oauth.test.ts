import { describe, it, expect } from "vitest";
import { parseAllowedDomains, isAllowedEmail } from "@/lib/google-oauth";

describe("parseAllowedDomains", () => {
  it("separa por comas, recorta y baja a minúsculas", () => {
    expect(parseAllowedDomains(" Hiuman.edu.MX , otro.com ")).toEqual(["hiuman.edu.mx", "otro.com"]);
  });
  it("descarta entradas vacías para que una coma sobrante no cuente como dominio", () => {
    expect(parseAllowedDomains("a.com,,b.com,")).toEqual(["a.com", "b.com"]);
  });
  it("una var vacía deja la lista vacía", () => {
    expect(parseAllowedDomains("")).toEqual([]);
  });
});

describe("isAllowedEmail", () => {
  const domains = ["hiuman.edu.mx", "otro.com"];

  it("acepta un correo del dominio, sin importar mayúsculas", () => {
    expect(isAllowedEmail("Pablo.Sanchez@Hiuman.edu.MX", domains)).toBe(true);
  });
  it("rechaza un dominio ajeno", () => {
    expect(isAllowedEmail("alguien@gmail.com", domains)).toBe(false);
  });
  it("rechaza un SUBdominio no listado", () => {
    expect(isAllowedEmail("alguien@sub.hiuman.edu.mx", domains)).toBe(false);
  });
  it("rechaza un dominio que sólo termina igual (sin el punto)", () => {
    expect(isAllowedEmail("alguien@nohiuman.edu.mx", domains)).toBe(false);
  });
  it("con la lista vacía no entra nadie", () => {
    expect(isAllowedEmail("pablo@hiuman.edu.mx", [])).toBe(false);
  });
  it("rechaza correos malformados", () => {
    expect(isAllowedEmail("sin-arroba", domains)).toBe(false);
    expect(isAllowedEmail("@hiuman.edu.mx", domains)).toBe(false);
    expect(isAllowedEmail("dos@arrobas@hiuman.edu.mx", domains)).toBe(false);
    expect(isAllowedEmail("vacio@", domains)).toBe(false);
  });
});
