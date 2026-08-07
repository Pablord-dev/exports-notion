import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseAllowedDomains, isAllowedEmail, newState, newPkce, callbackUrl, authorizeUrl } from "@/lib/google-oauth";

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

describe("newState / newPkce", () => {
  it("el state no se repite entre llamadas", () => {
    expect(newState()).not.toBe(newState());
  });
  it("el verifier cumple el largo mínimo de PKCE (43 chars)", () => {
    expect(newPkce().verifier.length).toBeGreaterThanOrEqual(43);
  });
  it("el challenge es el SHA-256 del verifier en base64url", () => {
    const { verifier, challenge } = newPkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
  it("ni el state ni el verifier necesitan escaparse en una URL", () => {
    // base64url: sólo [A-Za-z0-9_-]. Con base64 normal, el `+` de un state se
    // convertiría en espacio al parsear el query y el state jamás coincidiría.
    expect(newPkce().verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(newState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("callbackUrl", () => {
  it("cuelga la ruta del callback del origin", () => {
    expect(callbackUrl("http://localhost:3000")).toBe("http://localhost:3000/api/auth/google/callback");
  });
});

describe("authorizeUrl", () => {
  const url = () => new URL(authorizeUrl({
    clientId: "cid", redirectUri: "http://localhost:3000/api/auth/google/callback",
    state: "st4te", codeChallenge: "ch4llenge",
  }));

  it("apunta al endpoint de autorización de Google", () => {
    expect(url().origin + url().pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });
  it("pide sólo los scopes no sensibles", () => {
    expect(url().searchParams.get("scope")).toBe("openid email profile");
  });
  it("declara PKCE con S256", () => {
    expect(url().searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url().searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("lleva state, client_id, redirect_uri y response_type=code", () => {
    const q = url().searchParams;
    expect(q.get("state")).toBe("st4te");
    expect(q.get("client_id")).toBe("cid");
    expect(q.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
    expect(q.get("response_type")).toBe("code");
  });
  it("no pide acceso offline: nunca volvemos a llamar a Google tras el login", () => {
    expect(url().searchParams.get("access_type")).toBe("online");
  });
  it("deja elegir cuenta", () => {
    expect(url().searchParams.get("prompt")).toBe("select_account");
  });
});
