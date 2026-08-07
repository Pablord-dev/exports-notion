import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  resolveCallback, sealTx, openTx, __setTokenFetcher, __resetTokenFetcher,
  type CallbackEnv,
} from "@/lib/google-oauth";
import { GET as stubLogin } from "@/app/api/auth/stub-login/route";

const SECRET = "x".repeat(32);
const NOW = Date.UTC(2026, 7, 7, 12, 0, 0);

const env: CallbackEnv = {
  clientId: "cid",
  clientSecret: "sec",
  sessionSecret: SECRET,
  origin: "http://localhost:3000",
  allowedDomains: "hiuman.edu.mx",
};

function idToken(over: Record<string, unknown> = {}): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const payload = {
    aud: "cid",
    iss: "https://accounts.google.com",
    exp: Math.floor(NOW / 1000) + 3600,
    email: "pablo@hiuman.edu.mx",
    email_verified: true,
    name: "Pablo Sánchez",
    ...over,
  };
  return `${b64({ alg: "RS256" })}.${b64(payload)}.firma`;
}

/** Google devuelve este id_token para cualquier code. */
function googleReturns(over: Record<string, unknown> = {}) {
  __setTokenFetcher(async () =>
    new Response(JSON.stringify({ id_token: idToken(over) }), { status: 200 }));
}

describe("sealTx / openTx", () => {
  it("un round-trip devuelve la transacción intacta", async () => {
    const sealed = await sealTx({ state: "st", verifier: "vf" }, SECRET);
    expect(await openTx(sealed, SECRET)).toEqual({ state: "st", verifier: "vf" });
  });
  it("una cookie manipulada no se abre", async () => {
    const sealed = await sealTx({ state: "st", verifier: "vf" }, SECRET);
    expect(await openTx(sealed.slice(0, -3) + "aaa", SECRET)).toBeNull();
  });
  it("una cookie sellada con otro secreto no se abre", async () => {
    const sealed = await sealTx({ state: "st", verifier: "vf" }, "y".repeat(32));
    expect(await openTx(sealed, SECRET)).toBeNull();
  });
  it("basura no lanza, devuelve null", async () => {
    expect(await openTx("no-es-una-cookie", SECRET)).toBeNull();
  });
});

describe("resolveCallback", () => {
  let sealed: string;
  beforeEach(async () => { sealed = await sealTx({ state: "st4te", verifier: "verif" }, SECRET); });
  afterEach(() => __resetTokenFetcher());

  const call = (over: Partial<Parameters<typeof resolveCallback>[0]> = {}) =>
    resolveCallback({ code: "c0de", state: "st4te", googleError: null, sealedTx: sealed, env, nowMs: NOW, ...over });

  it("camino feliz: devuelve la identidad", async () => {
    googleReturns();
    expect(await call()).toEqual({ ok: true, identity: { email: "pablo@hiuman.edu.mx", name: "Pablo Sánchez" } });
  });

  it("si Google manda error, no canjea nada", async () => {
    let llamado = false;
    __setTokenFetcher(async () => { llamado = true; return new Response("{}", { status: 200 }); });
    expect(await call({ googleError: "access_denied" })).toEqual({ ok: false, failure: "google" });
    expect(llamado).toBe(false);
  });

  it("sin cookie de transacción falla como state", async () => {
    googleReturns();
    expect(await call({ sealedTx: undefined })).toEqual({ ok: false, failure: "state" });
  });

  it("state que no coincide falla y NO canjea el code", async () => {
    let llamado = false;
    __setTokenFetcher(async () => { llamado = true; return new Response("{}", { status: 200 }); });
    expect(await call({ state: "otro" })).toEqual({ ok: false, failure: "state" });
    expect(llamado).toBe(false);
  });

  it("sin code falla como state", async () => {
    googleReturns();
    expect(await call({ code: null })).toEqual({ ok: false, failure: "state" });
  });

  it("si el canje falla, failure=token", async () => {
    __setTokenFetcher(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    expect(await call()).toEqual({ ok: false, failure: "token" });
  });

  it("correo sin verificar: failure=unverified", async () => {
    googleReturns({ email_verified: false });
    expect(await call()).toEqual({ ok: false, failure: "unverified" });
  });

  it("token con aud ajeno: failure=token, no filtra el detalle", async () => {
    googleReturns({ aud: "otra-app" });
    expect(await call()).toEqual({ ok: false, failure: "token" });
  });

  it("dominio fuera de la lista: failure=domain", async () => {
    googleReturns({ email: "alguien@gmail.com" });
    expect(await call()).toEqual({ ok: false, failure: "domain" });
  });

  it("con la lista de dominios vacía no entra nadie", async () => {
    googleReturns();
    expect(await call({ env: { ...env, allowedDomains: "" } })).toEqual({ ok: false, failure: "domain" });
  });

  it("canjea con el MISMO redirect_uri que se usó al autorizar", async () => {
    let body: URLSearchParams | null = null;
    __setTokenFetcher(async (_u, init) => {
      body = new URLSearchParams(String(init.body));
      return new Response(JSON.stringify({ id_token: idToken() }), { status: 200 });
    });
    await call();
    expect(body!.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
  });
});

// El gate de beforeExchange (el rate-limit en producción) corre DESPUÉS de las
// validaciones puras y ANTES del canje: una cancelación del usuario o un state
// forjado no deben consumir la ventana de 5/15min — sólo protege el canje real.
describe("resolveCallback · beforeExchange (rate-limit)", () => {
  let sealed: string;
  beforeEach(async () => { sealed = await sealTx({ state: "st4te", verifier: "verif" }, SECRET); });
  afterEach(() => __resetTokenFetcher());

  const call = (over: Partial<Parameters<typeof resolveCallback>[0]> = {}) =>
    resolveCallback({ code: "c0de", state: "st4te", googleError: null, sealedTx: sealed, env, nowMs: NOW, ...over });

  it("no se consume cuando Google manda error (el usuario canceló)", async () => {
    let gate = 0;
    await call({ googleError: "access_denied", beforeExchange: async () => { gate++; return true; } });
    expect(gate).toBe(0);
  });

  it("no se consume con un state que no coincide", async () => {
    let gate = 0;
    await call({ state: "otro", beforeExchange: async () => { gate++; return true; } });
    expect(gate).toBe(0);
  });

  it("gate negado: failure=rate y NO canjea el code", async () => {
    let llamado = false;
    __setTokenFetcher(async () => { llamado = true; return new Response("{}", { status: 200 }); });
    expect(await call({ beforeExchange: async () => false })).toEqual({ ok: false, failure: "rate" });
    expect(llamado).toBe(false);
  });

  it("el camino feliz lo consume exactamente una vez", async () => {
    googleReturns();
    let gate = 0;
    const r = await call({ beforeExchange: async () => { gate++; return true; } });
    expect(r.ok).toBe(true);
    expect(gate).toBe(1);
  });
});

describe("stub-login", () => {
  const original = process.env.E2E_STUBS;
  const req = () => new NextRequest("http://localhost:3000/api/auth/stub-login");
  afterEach(() => { process.env.E2E_STUBS = original; });

  it("responde 404 sin E2E_STUBS: una ruta que emite sesiones no puede existir en producción", async () => {
    delete process.env.E2E_STUBS;
    expect((await stubLogin(req())).status).toBe(404);
  });

  it("tampoco existe con un valor distinto de \"1\"", async () => {
    process.env.E2E_STUBS = "true";
    expect((await stubLogin(req())).status).toBe(404);
  });
});
