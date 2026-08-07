# Login con Google — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el password compartido por login con Google, de modo que la sesión sepa quién entró y sólo pasen correos de dominios autorizados.

**Architecture:** OAuth 2.0 Authorization Code + PKCE escrito a mano sobre la iron-session que ya existe. Toda la lógica vive en un módulo puro (`src/lib/google-oauth.ts`) sin imports de Next, y las route handlers sólo traducen entre HTTP y ese módulo. La sesión conserva la bandera `authenticated`, así que `src/proxy.ts` y las rutas de API que protege no se tocan.

**Tech Stack:** Next.js 16.2.6 (App Router), iron-session 8 (`sealData`/`unsealData` para la cookie temporal), `node:crypto` para state y PKCE, vitest, Playwright. **Cero dependencias nuevas.**

**Spec:** [2026-08-07-login-con-google-design.md](../specs/2026-08-07-login-con-google-design.md)

## Global Constraints

- **No se agregan dependencias.** El flujo usa `node:crypto` y `iron-session`, ya instaladas. Sale `bcryptjs`.
- **Comentarios y mensajes de UI en español.** El código y los identificadores en inglés, como el resto del repo.
- **Los comentarios explican el *por qué*,** no el qué. Es la convención del repo: si algo es contraintuitivo, se documenta la razón.
- **Scopes exactos:** `openid email profile`. Nada más — pedir un scope sensible obligaría a la verificación de Google.
- **Endpoints de Google, literales:** autorización `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`.
- **`iss` aceptados:** `accounts.google.com` **y** `https://accounts.google.com` (Google emite ambas formas).
- **Dominios:** comparación en minúsculas, exacta, contra lo que va después de la **última** `@`. Subdominio no listado = rechazado. Lista vacía = **nadie entra**.
- **`email_verified`:** comparación explícita `=== true || === "true"`. Nunca por *truthiness*.
- **Sin `returnTo`:** el callback siempre redirige a `/`.
- **Códigos de error del callback:** `state`, `google`, `token`, `unverified`, `domain`, `rate`. Ninguno filtra el correo ni el error crudo de Google.
- **Costuras de test al estilo del repo:** `__setTokenFetcher` / `__resetTokenFetcher`, como `__setLlmClient` y `__setStore`. **Nunca** `vi.mock` global.
- **Cada commit** lleva asunto imperativo de ≤72 caracteres, cuerpo con el *por qué* cuando no sea obvio, y el trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Gate antes de dar cualquier tarea por terminada:** `npm test && npm run lint && npx tsc --noEmit`, mostrando la salida real.
- **Rama:** `feat/google-login`. Ya existe, creada desde `main` (`6ac050a`).

## Estructura de archivos

**Se crean**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/google-oauth.ts` | **Toda** la lógica del flujo, sin imports de Next: state, PKCE, URL de autorización, cookie sellada, canje del code, lectura del ID token, allowlist y el orquestador puro `resolveCallback`. |
| `src/app/api/auth/google/route.ts` | Genera la transacción, deja la cookie, redirige a Google. |
| `src/app/api/auth/google/callback/route.ts` | Llama a `resolveCallback`, escribe la sesión o redirige con el código de error. |
| `src/app/api/auth/session/route.ts` | `GET` → `{ authenticated, user? }`. Fuera del matcher del proxy. |
| `src/app/api/auth/logout/route.ts` | `POST` → destruye la sesión. |
| `src/app/api/auth/stub-login/route.ts` | Sólo con `E2E_STUBS=1`; 404 en cualquier otro caso. |
| `tests/unit/google-oauth.test.ts` | Las funciones puras del módulo. |
| `tests/integration/auth-google.test.ts` | `resolveCallback` con doble del endpoint de token: los cinco caminos. |
| `docs/architecture/adr/0008-login-con-google-sobre-iron-session.md` | Por qué no Auth.js; la concesión de no verificar la firma. |

**Se modifican**

| Archivo | Cambio |
|---|---|
| `src/lib/session.ts` | `SessionData` gana `user?: { email, name }`. |
| `src/lib/auth.ts` | Queda como puro re-export: sale `verifyPassword`. |
| `src/lib/config.ts` | Sale `appPasswordHash`; entran 4 vars. De 7 obligatorias a **10**. |
| `src/instrumentation.ts` | El comentario dice "7 env vars"; pasa a 10. |
| `src/app/page.tsx` | Formulario de password → botón de Google + banner de `?error=`. |
| `src/app/components/app-shell.tsx` | Footer con identidad; logout a `POST /api/auth/logout`. |
| `playwright.config.ts` | `STUB_ENV`: sale `APP_PASSWORD_HASH`, entran las 4 nuevas. |
| `tests/unit/auth.test.ts` | Se queda sólo la parte de `sessionOptions`. |
| `tests/unit/config.test.ts` | Las 10 vars. |
| `tests/e2e/helpers.ts` | `login()` navega al stub en vez de llenar el password. |
| `.env.example`, `README.md`, `docs/guides/deploy.md`, `CLAUDE.md` | Documentación. |
| `package.json` | Sale `bcryptjs`. |

**Se borra:** `src/app/api/login/route.ts`.

### Nota sobre la superficie del módulo

El spec nombra cuatro funciones (`authorizeUrl`, `exchangeCode`, `readIdToken`, `isAllowedEmail`). El plan exporta además `newState`, `newPkce`, `callbackUrl`, `parseAllowedDomains`, `sealTx`, `openTx` y `resolveCallback`. La razón de `resolveCallback` es de **testabilidad**: `cookies()` de Next lanza fuera de un request, así que si la orquestación viviera en la route handler los cinco caminos de error sólo se podrían verificar a ojo. Recibiendo la cookie sellada como string, se testean de verdad.

### Nota sobre el orden

`GET /api/auth/google` y su callback (Tarea 8) quedan funcionando **antes** de que la Tarea 10 borre el login por password. Durante ese tramo conviven las dos puertas, así que se puede probar Google de verdad en el navegador sin quedarse fuera de la app si algo falla. **No empieces la Tarea 10 sin haber entrado con Google al menos una vez.**

---

### Task 1: Allowlist de dominios

**Files:**
- Create: `src/lib/google-oauth.ts`
- Test: `tests/unit/google-oauth.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `parseAllowedDomains(raw: string): string[]` y `isAllowedEmail(email: string, domains: string[]): boolean`.

- [ ] **Step 1: Write the failing test**

`tests/unit/google-oauth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/google-oauth.test.ts`
Expected: FAIL — no existe `src/lib/google-oauth.ts` ("Failed to resolve import").

- [ ] **Step 3: Write minimal implementation**

`src/lib/google-oauth.ts`:

```ts
// Login con Google: OAuth 2.0 Authorization Code + PKCE, escrito a mano sobre la
// iron-session que ya usa la app (ADR-0008). Este módulo NO importa nada de Next
// a propósito: así se testea suelto y las route handlers quedan de diez líneas.

/**
 * Lee ALLOWED_EMAIL_DOMAINS. Descarta entradas vacías para que una coma sobrante
 * ("a.com,") no registre un dominio fantasma que después acepte cualquier cosa.
 */
export function parseAllowedDomains(raw: string): string[] {
  return raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/**
 * Comparación EXACTA contra el dominio del correo: un comodín de subdominios es
 * la clase de laxitud que después nadie recuerda haber concedido. Lista vacía =
 * nadie entra, no "todos entran": si alguien borra la env var, el fallo es cerrado.
 */
export function isAllowedEmail(email: string, domains: string[]): boolean {
  if (domains.length === 0) return false;
  const at = email.indexOf("@");
  // Exactamente una @, y ni al principio ni al final.
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain) return false;
  return domains.includes(domain);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/google-oauth.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-oauth.ts tests/unit/google-oauth.test.ts
git commit -m "feat(auth): allowlist de dominios para el login con Google"
```

---

### Task 2: State, PKCE y URL de autorización

**Files:**
- Modify: `src/lib/google-oauth.ts`
- Test: `tests/unit/google-oauth.test.ts`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  - `newState(): string`
  - `newPkce(): { verifier: string; challenge: string }`
  - `callbackUrl(origin: string): string`
  - `authorizeUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string`

- [ ] **Step 1: Write the failing test**

Añade a `tests/unit/google-oauth.test.ts` (y amplía el import de la primera línea con los cuatro nombres nuevos):

```ts
import { createHash } from "node:crypto";
import { newState, newPkce, callbackUrl, authorizeUrl } from "@/lib/google-oauth";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/google-oauth.test.ts`
Expected: FAIL — "newState is not a function" (o error de import).

- [ ] **Step 3: Write minimal implementation**

Añade a `src/lib/google-oauth.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** base64url para que entre en una URL sin escapes ni sorpresas de encoding. */
export function newState(): string {
  return randomBytes(32).toString("base64url");
}

/** PKCE S256. Con cliente confidencial es cinturón y tirantes, pero son seis
 *  líneas y cierra el robo del `code` en tránsito. */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url"); // 43 chars, el mínimo del RFC
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** El redirect_uri tiene que ser IDÉNTICO en la autorización y en el canje del
 *  code, o Google responde redirect_uri_mismatch. Una sola función para que las
 *  dos rutas no puedan divergir. */
export function callbackUrl(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

export function authorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    // Sin refresh token: no hay nada que guardar ni renovar.
    access_type: "online",
  });
  return `${AUTH_ENDPOINT}?${q}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/google-oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-oauth.ts tests/unit/google-oauth.test.ts
git commit -m "feat(auth): state, PKCE y URL de autorización de Google"
```

---

### Task 3: Lectura del ID token

**Files:**
- Modify: `src/lib/google-oauth.ts`
- Test: `tests/unit/google-oauth.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export interface GoogleIdentity { email: string; name: string }`
  - `export type IdTokenProblem = "malformed" | "aud" | "iss" | "expired" | "unverified"`
  - `readIdToken(idToken: string, o: { clientId: string; nowMs: number }): { ok: true; identity: GoogleIdentity } | { ok: false; problem: IdTokenProblem }`

- [ ] **Step 1: Write the failing test**

Añade a `tests/unit/google-oauth.test.ts`:

```ts
import { readIdToken } from "@/lib/google-oauth";

/** Arma un JWT de tres partes con la firma en blanco: readIdToken no verifica
 *  firma a propósito (el token viene del canje directo por TLS), así que para el
 *  test la firma es irrelevante. */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.firma-no-verificada`;
}

const NOW = Date.UTC(2026, 7, 7, 12, 0, 0);
const base = {
  aud: "cid",
  iss: "https://accounts.google.com",
  exp: Math.floor(NOW / 1000) + 3600,
  email: "pablo@hiuman.edu.mx",
  email_verified: true,
  name: "Pablo Sánchez",
};

describe("readIdToken", () => {
  const read = (p: Record<string, unknown>) => readIdToken(fakeIdToken(p), { clientId: "cid", nowMs: NOW });

  it("devuelve correo y nombre de un token válido", () => {
    expect(read(base)).toEqual({ ok: true, identity: { email: "pablo@hiuman.edu.mx", name: "Pablo Sánchez" } });
  });
  it("acepta el iss sin esquema, que Google también emite", () => {
    expect(read({ ...base, iss: "accounts.google.com" })).toEqual({
      ok: true, identity: { email: "pablo@hiuman.edu.mx", name: "Pablo Sánchez" },
    });
  });
  it("cae al correo cuando no viene el nombre", () => {
    const r = read({ ...base, name: undefined });
    expect(r).toEqual({ ok: true, identity: { email: "pablo@hiuman.edu.mx", name: "pablo@hiuman.edu.mx" } });
  });
  it("rechaza un aud de otra app", () => {
    expect(read({ ...base, aud: "otra-app" })).toEqual({ ok: false, problem: "aud" });
  });
  it("rechaza un iss ajeno", () => {
    expect(read({ ...base, iss: "https://evil.example" })).toEqual({ ok: false, problem: "iss" });
  });
  it("rechaza un token vencido", () => {
    expect(read({ ...base, exp: Math.floor(NOW / 1000) - 1 })).toEqual({ ok: false, problem: "expired" });
  });
  it("rechaza un correo sin verificar", () => {
    expect(read({ ...base, email_verified: false })).toEqual({ ok: false, problem: "unverified" });
  });
  it("no acepta email_verified por truthiness", () => {
    expect(read({ ...base, email_verified: "yes" })).toEqual({ ok: false, problem: "unverified" });
    expect(read({ ...base, email_verified: 1 })).toEqual({ ok: false, problem: "unverified" });
  });
  it("acepta el string \"true\", por si Google lo emite así", () => {
    expect(read({ ...base, email_verified: "true" }).ok).toBe(true);
  });
  it("rechaza un token sin las tres partes o con payload ilegible", () => {
    expect(readIdToken("no-es-un-jwt", { clientId: "cid", nowMs: NOW })).toEqual({ ok: false, problem: "malformed" });
    expect(readIdToken("a.b.c", { clientId: "cid", nowMs: NOW })).toEqual({ ok: false, problem: "malformed" });
  });
  it("rechaza un token sin correo", () => {
    expect(read({ ...base, email: undefined })).toEqual({ ok: false, problem: "malformed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/google-oauth.test.ts`
Expected: FAIL — "readIdToken is not a function".

- [ ] **Step 3: Write minimal implementation**

Añade a `src/lib/google-oauth.ts`:

```ts
/** Los dos valores de `iss` que Google emite. Validar sólo uno rechazaría
 *  logins legítimos. */
const GOOGLE_ISS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface GoogleIdentity {
  email: string;
  name: string;
}

export type IdTokenProblem = "malformed" | "aud" | "iss" | "expired" | "unverified";

/**
 * Lee el ID token SIN verificar su firma. Es deliberado y sólo vale porque el
 * token llega del canje directo con el endpoint de Google por TLS: el canal ya
 * autentica el origen, y la verificación de firma es para tokens que llegan de
 * terceros. ⚠️ Si algún día se acepta un id_token por otra vía, hay que verificar
 * la firma (JWKS) antes de confiar en estos claims.
 */
export function readIdToken(
  idToken: string,
  o: { clientId: string; nowMs: number },
): { ok: true; identity: GoogleIdentity } | { ok: false; problem: IdTokenProblem } {
  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, problem: "malformed" };

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, problem: "malformed" };
  }
  if (!claims || typeof claims !== "object") return { ok: false, problem: "malformed" };

  if (claims.aud !== o.clientId) return { ok: false, problem: "aud" };
  if (typeof claims.iss !== "string" || !GOOGLE_ISS.has(claims.iss)) return { ok: false, problem: "iss" };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= o.nowMs) return { ok: false, problem: "expired" };

  const email = claims.email;
  if (typeof email !== "string" || !email) return { ok: false, problem: "malformed" };

  // Explícito, nunca por truthiness: un claim ausente o con cualquier otro valor
  // es "no verificado". Sin esto, alguien podría declarar un correo del dominio
  // sin poseerlo.
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!verified) return { ok: false, problem: "unverified" };

  // Google no garantiza `name`. Sin fallback, la UI mostraría un hueco donde va
  // una persona.
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email;
  return { ok: true, identity: { email, name } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/google-oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-oauth.ts tests/unit/google-oauth.test.ts
git commit -m "feat(auth): leer y validar los claims del ID token de Google"
```

---

### Task 4: Canje del code y costura de tests

**Files:**
- Modify: `src/lib/google-oauth.ts`
- Test: `tests/unit/google-oauth.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string; clientId: string; clientSecret: string }): Promise<{ ok: true; idToken: string } | { ok: false }>`
  - `__setTokenFetcher(f: (url: string, init: RequestInit) => Promise<Response>): void`
  - `__resetTokenFetcher(): void`

- [ ] **Step 1: Write the failing test**

Añade a `tests/unit/google-oauth.test.ts` (`afterEach` va **agregado al import de
`vitest` que ya existe** en la primera línea, no en un import nuevo: `eslint` marca
imports duplicados del mismo módulo):

```ts
import { exchangeCode, __setTokenFetcher, __resetTokenFetcher } from "@/lib/google-oauth";

describe("exchangeCode", () => {
  afterEach(() => __resetTokenFetcher());

  it("postea al endpoint de token con el code, el verifier y el secreto", async () => {
    let seen: { url: string; body: URLSearchParams } | null = null;
    __setTokenFetcher(async (url, init) => {
      seen = { url, body: new URLSearchParams(String(init.body)) };
      return new Response(JSON.stringify({ id_token: "tok" }), { status: 200 });
    });

    const r = await exchangeCode({
      code: "c0de", codeVerifier: "verif", redirectUri: "http://localhost:3000/api/auth/google/callback",
      clientId: "cid", clientSecret: "sec",
    });

    expect(r).toEqual({ ok: true, idToken: "tok" });
    expect(seen!.url).toBe("https://oauth2.googleapis.com/token");
    expect(seen!.body.get("code")).toBe("c0de");
    expect(seen!.body.get("code_verifier")).toBe("verif");
    expect(seen!.body.get("client_secret")).toBe("sec");
    expect(seen!.body.get("grant_type")).toBe("authorization_code");
    expect(seen!.body.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
  });

  it("falla si Google responde con error", async () => {
    __setTokenFetcher(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    expect(await exchangeCode({
      code: "c0de", codeVerifier: "v", redirectUri: "r", clientId: "cid", clientSecret: "sec",
    })).toEqual({ ok: false });
  });

  it("falla si la respuesta no trae id_token", async () => {
    __setTokenFetcher(async () => new Response(JSON.stringify({ access_token: "solo-este" }), { status: 200 }));
    expect(await exchangeCode({
      code: "c0de", codeVerifier: "v", redirectUri: "r", clientId: "cid", clientSecret: "sec",
    })).toEqual({ ok: false });
  });

  it("falla si la respuesta no es JSON", async () => {
    __setTokenFetcher(async () => new Response("<html>502</html>", { status: 200 }));
    expect(await exchangeCode({
      code: "c0de", codeVerifier: "v", redirectUri: "r", clientId: "cid", clientSecret: "sec",
    })).toEqual({ ok: false });
  });

  it("falla si la red se cae, sin propagar la excepción", async () => {
    __setTokenFetcher(async () => { throw new Error("ECONNRESET"); });
    expect(await exchangeCode({
      code: "c0de", codeVerifier: "v", redirectUri: "r", clientId: "cid", clientSecret: "sec",
    })).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/google-oauth.test.ts`
Expected: FAIL — "exchangeCode is not a function".

- [ ] **Step 3: Write minimal implementation**

Añade a `src/lib/google-oauth.ts`:

```ts
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type TokenFetcher = (url: string, init: RequestInit) => Promise<Response>;
const realFetcher: TokenFetcher = (url, init) => fetch(url, init);
let tokenFetcher: TokenFetcher = realFetcher;

/** Costura de tests, mismo patrón que __setLlmClient / __setStore: inyectar un
 *  doble en vez de mockear módulos globalmente. */
export function __setTokenFetcher(f: TokenFetcher): void {
  tokenFetcher = f;
}
export function __resetTokenFetcher(): void {
  tokenFetcher = realFetcher;
}

/**
 * Canjea el `code` por tokens. Devuelve un resultado, nunca lanza: para el
 * callback cualquier fallo aquí es el mismo error de cara al usuario, y una
 * excepción sin atrapar convertiría un login fallido en un 500.
 */
export async function exchangeCode(p: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ ok: true; idToken: string } | { ok: false }> {
  const body = new URLSearchParams({
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
    grant_type: "authorization_code",
    code_verifier: p.codeVerifier,
  });
  try {
    const r = await tokenFetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!r.ok) return { ok: false };
    const j = (await r.json()) as { id_token?: unknown };
    if (typeof j?.id_token !== "string" || !j.id_token) return { ok: false };
    return { ok: true, idToken: j.id_token };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/google-oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-oauth.ts tests/unit/google-oauth.test.ts
git commit -m "feat(auth): canjear el code de Google por el ID token"
```

---

### Task 5: Cookie sellada y `resolveCallback`

Es el corazón del flujo: la función que decide si alguien entra. Todo lo que la rodea (Tarea 8) es traducción de HTTP.

**Files:**
- Modify: `src/lib/google-oauth.ts`
- Test: `tests/integration/auth-google.test.ts`

**Interfaces:**
- Consumes: `exchangeCode`, `readIdToken`, `isAllowedEmail`, `parseAllowedDomains` (Tareas 1, 3, 4).
- Produces:
  - `export const TX_COOKIE = "oauth-tx"` y `export const TX_TTL_SEC = 600`
  - `export interface OAuthTx { state: string; verifier: string }`
  - `sealTx(tx: OAuthTx, password: string): Promise<string>`
  - `openTx(sealed: string, password: string): Promise<OAuthTx | null>`
  - `export type CallbackFailure = "state" | "google" | "token" | "unverified" | "domain"`
  - `resolveCallback(input: { code: string | null; state: string | null; googleError: string | null; sealedTx: string | undefined; env: CallbackEnv; nowMs: number }): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; failure: CallbackFailure }>`
  - `export interface CallbackEnv { clientId: string; clientSecret: string; sessionSecret: string; origin: string; allowedDomains: string }`

- [ ] **Step 1: Write the failing test**

`tests/integration/auth-google.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveCallback, sealTx, openTx, __setTokenFetcher, __resetTokenFetcher,
  type CallbackEnv,
} from "@/lib/google-oauth";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth-google.test.ts`
Expected: FAIL — "resolveCallback is not a function" / no existe `sealTx`.

- [ ] **Step 3: Write minimal implementation**

Añade a `src/lib/google-oauth.ts` (el import de `iron-session` va arriba, junto a los otros):

```ts
import { sealData, unsealData } from "iron-session";

/** Cookie de la transacción en curso: state + code_verifier, cifrados. Vive 10
 *  minutos porque es el tiempo de una vuelta a Google, no una sesión. */
export const TX_COOKIE = "oauth-tx";
export const TX_TTL_SEC = 600;

export interface OAuthTx {
  state: string;
  verifier: string;
}

export async function sealTx(tx: OAuthTx, password: string): Promise<string> {
  return sealData(tx, { password, ttl: TX_TTL_SEC });
}

/** Devuelve null en vez de lanzar: una cookie vencida, manipulada o ausente son
 *  el mismo caso para quien llama —transacción inválida—. */
export async function openTx(sealed: string, password: string): Promise<OAuthTx | null> {
  try {
    const tx = await unsealData<OAuthTx>(sealed, { password, ttl: TX_TTL_SEC });
    if (!tx || typeof tx.state !== "string" || typeof tx.verifier !== "string") return null;
    if (!tx.state || !tx.verifier) return null;
    return tx;
  } catch {
    return null;
  }
}

export interface CallbackEnv {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  origin: string;
  /** ALLOWED_EMAIL_DOMAINS crudo; se parsea aquí. */
  allowedDomains: string;
}

export type CallbackFailure = "state" | "google" | "token" | "unverified" | "domain";

/**
 * Decide si alguien entra. Puro a propósito: recibe la cookie sellada como
 * string en vez de leerla de `cookies()`, porque esa API de Next lanza fuera de
 * un request y la orquestación quedaría sin tests. La route handler sólo traduce
 * HTTP ↔ esta función.
 */
export async function resolveCallback(input: {
  code: string | null;
  state: string | null;
  googleError: string | null;
  sealedTx: string | undefined;
  env: CallbackEnv;
  nowMs: number;
}): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; failure: CallbackFailure }> {
  // El usuario canceló en la pantalla de Google, o Google rechazó la petición.
  if (input.googleError) return { ok: false, failure: "google" };
  if (!input.code || !input.state || !input.sealedTx) return { ok: false, failure: "state" };

  const tx = await openTx(input.sealedTx, input.env.sessionSecret);
  // El state se compara ANTES de canjear: sin esto, un code inyectado por un
  // tercero se cambiaría por una sesión.
  if (!tx || tx.state !== input.state) return { ok: false, failure: "state" };

  const redirectUri = callbackUrl(input.env.origin);
  const ex = await exchangeCode({
    code: input.code,
    codeVerifier: tx.verifier,
    redirectUri,
    clientId: input.env.clientId,
    clientSecret: input.env.clientSecret,
  });
  if (!ex.ok) return { ok: false, failure: "token" };

  const read = readIdToken(ex.idToken, { clientId: input.env.clientId, nowMs: input.nowMs });
  if (!read.ok) {
    // "unverified" es el único problema del token que se le explica al usuario:
    // es el único que puede resolver él. El resto es un fallo nuestro o un ataque.
    return { ok: false, failure: read.problem === "unverified" ? "unverified" : "token" };
  }

  if (!isAllowedEmail(read.identity.email, parseAllowedDomains(input.env.allowedDomains))) {
    return { ok: false, failure: "domain" };
  }
  return { ok: true, identity: read.identity };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth-google.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Full gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: todo verde. Muestra la salida real.

- [ ] **Step 6: Commit**

```bash
git add src/lib/google-oauth.ts tests/integration/auth-google.test.ts
git commit -m "feat(auth): resolver el callback de Google como función pura"
```

---

### Task 6: Configuración — de 7 env vars a 10

⚠️ **Antes del Step 3, agrega las cuatro vars a tu `.env.local`.** El fail-fast de `instrumentation.ts` impide arrancar el server sin ellas, así que en cuanto `config.ts` las exija, `npm run dev` deja de levantar. Valores de relleno sirven hasta la Tarea 8 (nada llama a Google todavía):

```
GOOGLE_CLIENT_ID=pendiente
GOOGLE_CLIENT_SECRET=pendiente
ALLOWED_EMAIL_DOMAINS=hiuman.edu.mx
APP_ORIGIN=http://localhost:3000
```

**Files:**
- Modify: `src/lib/config.ts`, `src/instrumentation.ts:2`, `playwright.config.ts:17-27`, `.env.example`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `AppConfig` con `googleClientId`, `googleClientSecret`, `allowedEmailDomains`, `appOrigin`; sin `appPasswordHash`.

- [ ] **Step 1: Write the failing test**

Reemplaza `tests/unit/config.test.ts` completo:

```ts
// tests/unit/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "@/lib/config";

const required = [
  "NOTION_TOKEN",
  "NOTION_DATABASE_ID",
  "DATE_COLUMN",
  "SESSION_SECRET",
  "CRON_SECRET",
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ALLOWED_EMAIL_DOMAINS",
  "APP_ORIGIN",
];

describe("loadConfig", () => {
  const original = { ...process.env };
  beforeEach(() => { for (const k of required) process.env[k] = `test-${k}`; });
  afterEach(() => { process.env = { ...original }; });

  it("returns a typed config when all env vars are present", () => {
    const cfg = loadConfig();
    expect(cfg.notionToken).toBe("test-NOTION_TOKEN");
    expect(cfg.databaseId).toBe("test-NOTION_DATABASE_ID");
    expect(cfg.dateColumn).toBe("test-DATE_COLUMN");
    expect(cfg.googleClientId).toBe("test-GOOGLE_CLIENT_ID");
    expect(cfg.googleClientSecret).toBe("test-GOOGLE_CLIENT_SECRET");
    expect(cfg.allowedEmailDomains).toBe("test-ALLOWED_EMAIL_DOMAINS");
    expect(cfg.appOrigin).toBe("test-APP_ORIGIN");
  });

  it("exige las 10 vars", () => {
    expect(required).toHaveLength(10);
    for (const k of required) {
      const saved = process.env[k];
      delete process.env[k];
      expect(() => loadConfig(), `${k} debería ser obligatoria`).toThrow(new RegExp(k));
      process.env[k] = saved;
    }
  });

  it("ya no exige el password compartido", () => {
    delete process.env.APP_PASSWORD_HASH;
    expect(() => loadConfig()).not.toThrow();
  });

  it("throws listing missing vars", () => {
    delete process.env.NOTION_TOKEN;
    delete process.env.SESSION_SECRET;
    expect(() => loadConfig()).toThrow(/NOTION_TOKEN.*SESSION_SECRET/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL — `cfg.googleClientId` es `undefined` y el test de las 10 falla en `GOOGLE_CLIENT_ID`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/config.ts`, reemplazando la interfaz y el mapa:

```ts
// src/lib/config.ts
export interface AppConfig {
  notionToken: string;
  databaseId: string;
  dateColumn: string;
  sessionSecret: string;
  cronSecret: string;
  /** Postgres (Supabase) — ADR 0006. */
  databaseUrl: string;
  /** Login con Google — ADR 0008. */
  googleClientId: string;
  googleClientSecret: string;
  /** Dominios autorizados, separados por comas. Vacío = nadie entra. */
  allowedEmailDomains: string;
  /** Origin público de esta instancia. El redirect_uri se arma con él y tiene
   *  que coincidir carácter por carácter con el registrado en Google; derivarlo
   *  del request rompe en cuanto un proxy reescribe el Host, y sólo en producción. */
  appOrigin: string;
}

const KEYS: Record<keyof AppConfig, string> = {
  notionToken: "NOTION_TOKEN",
  databaseId: "NOTION_DATABASE_ID",
  dateColumn: "DATE_COLUMN",
  sessionSecret: "SESSION_SECRET",
  cronSecret: "CRON_SECRET",
  databaseUrl: "DATABASE_URL",
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  allowedEmailDomains: "ALLOWED_EMAIL_DOMAINS",
  appOrigin: "APP_ORIGIN",
};
```

`loadConfig()` no cambia: itera sobre `KEYS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Actualiza el comentario del fail-fast**

En `src/instrumentation.ts:2`, cambia "valida las 7 env vars obligatorias" por "valida las 10 env vars obligatorias".

- [ ] **Step 6: Actualiza `playwright.config.ts`**

En `STUB_ENV` (líneas 17-27): borra la línea `APP_PASSWORD_HASH: "e2e-dummy",` y agrega, antes del cierre:

```ts
  // El stub nunca habla con Google (E2E_STUBS=1 entra por /api/auth/stub-login),
  // pero loadConfig las exige.
  GOOGLE_CLIENT_ID: "e2e-dummy",
  GOOGLE_CLIENT_SECRET: "e2e-dummy",
  ALLOWED_EMAIL_DOMAINS: "hiuman.edu.mx",
  APP_ORIGIN: `http://localhost:${PORT}`,
```

En el comentario de arriba (líneas 10-16), cambia la primera frase: donde dice `Password del entorno stub: "e2e-password" (resuelto en verifyPassword con E2E_STUBS=1)` pon `El entorno stub entra por /api/auth/stub-login, que sólo existe con E2E_STUBS=1`.

- [ ] **Step 7: Actualiza `.env.example`**

Reemplaza el bloque `# App auth` (líneas 6-8) por:

```
# App auth — login con Google (ADR 0008)
#   Un solo proyecto de Google Cloud: el Client ID identifica la APP, no el
#   dominio de quien entra. La pantalla de consentimiento va como "External" y
#   publicada; los scopes son sólo openid/email/profile, que no requieren
#   verificación de Google.
#   Redirect URI a registrar (exacto, sin comodines):
#     <APP_ORIGIN>/api/auth/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Dominios autorizados, separados por comas. Comparación EXACTA: un subdominio
# no listado NO entra. Vacío = nadie entra.
ALLOWED_EMAIL_DOMAINS=hiuman.edu.mx
# Origin público de esta instancia (sin barra final). En local, el del dev server.
APP_ORIGIN=http://localhost:3000
SESSION_SECRET=
```

- [ ] **Step 8: Verify the gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde. `tests/unit/auth.test.ts` sigue pasando (aún existe `verifyPassword`).

- [ ] **Step 9: Commit**

```bash
git add src/lib/config.ts src/instrumentation.ts playwright.config.ts .env.example tests/unit/config.test.ts
git commit -m "feat(auth): exigir las credenciales de Google en la config"
```

---

### Task 7: La sesión gana identidad

**Files:**
- Modify: `src/lib/session.ts`
- Create: `src/app/api/auth/session/route.ts`, `src/app/api/auth/logout/route.ts`
- Test: `tests/unit/auth.test.ts` (sólo se verifica que siga verde)

**Interfaces:**
- Consumes: nada.
- Produces: `SessionData { authenticated?: true; user?: SessionUser }` con `export interface SessionUser { email: string; name: string }`. `GET /api/auth/session` → `{ authenticated: boolean; user?: SessionUser }`. `POST /api/auth/logout` → `{ ok: true }`.

- [ ] **Step 1: Amplía `SessionData`**

`src/lib/session.ts`, reemplazando la interfaz:

```ts
export interface SessionUser {
  email: string;
  name: string;
}

export interface SessionData {
  /** Se conserva tal cual: es la condición que evalúan proxy.ts y las rutas de
   *  API, y así el login con Google no las obliga a cambiar. La identidad se
   *  suma, no sustituye. */
  authenticated?: true;
  /** Ausente en cookies emitidas antes del login con Google (ADR-0008). */
  user?: SessionUser;
}
```

- [ ] **Step 2: Crea la ruta de sesión**

`src/app/api/auth/session/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

/**
 * Quién está dentro. NO está en el matcher de proxy.ts a propósito: tiene que
 * poder contestar { authenticated: false } sin sesión en vez de 401, porque la
 * llama el shell y no un consumidor de datos.
 */
export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.authenticated) return NextResponse.json({ authenticated: false });
  return NextResponse.json({ authenticated: true, user: session.user ?? null });
}
```

- [ ] **Step 3: Crea la ruta de logout**

`src/app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function POST() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.destroy();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Verify the gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde. `DELETE /api/login` sigue existiendo: el shell aún lo usa y se cambia en la Tarea 11.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/app/api/auth/session/route.ts src/app/api/auth/logout/route.ts
git commit -m "feat(auth): identidad en la sesión y rutas de sesión y logout"
```

---

### Task 8: Las dos rutas de Google

Al terminar esta tarea el login con Google **funciona de verdad** y conviven las dos puertas.

**Files:**
- Create: `src/app/api/auth/google/route.ts`, `src/app/api/auth/google/callback/route.ts`

**Interfaces:**
- Consumes: `authorizeUrl`, `newState`, `newPkce`, `callbackUrl`, `sealTx`, `resolveCallback`, `TX_COOKIE`, `TX_TTL_SEC`, `type CallbackEnv` (Tareas 2, 5); `SessionData` (Tarea 7); `rateLimitLogin` de `@/lib/db`.
- Produces: `GET /api/auth/google` (302 a Google) y `GET /api/auth/google/callback` (302 a `/` o a `/?error=<código>`).

- [ ] **Step 1: Crea el arranque del flujo**

`src/app/api/auth/google/route.ts`:

```ts
import { NextResponse } from "next/server";
import { authorizeUrl, callbackUrl, newPkce, newState, sealTx, TX_COOKIE, TX_TTL_SEC } from "@/lib/google-oauth";

export async function GET() {
  const state = newState();
  const { verifier, challenge } = newPkce();
  const origin = process.env.APP_ORIGIN!;
  const sealed = await sealTx({ state, verifier }, process.env.SESSION_SECRET!);

  const res = NextResponse.redirect(authorizeUrl({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    redirectUri: callbackUrl(origin),
    state,
    codeChallenge: challenge,
  }));

  // sameSite "lax" es OBLIGATORIO aquí, no una preferencia: la vuelta desde
  // Google es una navegación de otro sitio, y con "strict" el navegador no
  // mandaría esta cookie y el callback vería una transacción inexistente.
  res.cookies.set(TX_COOKIE, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TX_TTL_SEC,
    path: "/",
  });
  return res;
}
```

- [ ] **Step 2: Crea el callback**

`src/app/api/auth/google/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { resolveCallback, TX_COOKIE, type CallbackEnv } from "@/lib/google-oauth";
import { rateLimitLogin } from "@/lib/db";

export async function GET(req: NextRequest) {
  // ⚠️ Dos orígenes distintos a propósito, y confundirlos rompe cosas:
  //   · APP_ORIGIN va al redirect_uri, porque tiene que coincidir carácter por
  //     carácter con el registrado en Google.
  //   · Los redirects a NUESTRAS páginas van contra el origin del request. En el
  //     E2E el server corre en :3100 pero `next start` pisa el env heredado con
  //     .env.local, donde APP_ORIGIN dice :3000 — usarlo aquí mandaría a
  //     Playwright a otro server. Y en un preview de Vercel, a otro dominio.
  const appOrigin = process.env.APP_ORIGIN!;
  const here = req.nextUrl.origin;
  const jar = await cookies();

  // Un solo lugar para salir mal: borra siempre la cookie de transacción, así un
  // intento fallido no deja un state reutilizable dando vueltas.
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/?error=${code}`, here));
    res.cookies.delete(TX_COOKIE);
    return res;
  };

  // Cada callback con un code inventado hace que NUESTRA función salga a hablar
  // con Google. Sin tope es un grifo abierto de invocaciones. Reusa la tabla
  // login_attempts, que ya existe. E2E_STUBS comparte el bucket "unknown" entre
  // workers, mismo motivo que tenía /api/login.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (process.env.E2E_STUBS !== "1" && !(await rateLimitLogin(ip))) return fail("rate");

  const env: CallbackEnv = {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    sessionSecret: process.env.SESSION_SECRET!,
    origin: appOrigin,
    allowedDomains: process.env.ALLOWED_EMAIL_DOMAINS!,
  };

  const q = req.nextUrl.searchParams;
  const r = await resolveCallback({
    code: q.get("code"),
    state: q.get("state"),
    googleError: q.get("error"),
    sealedTx: jar.get(TX_COOKIE)?.value,
    env,
    nowMs: Date.now(),
  });
  if (!r.ok) return fail(r.failure);

  const session = await getIronSession<SessionData>(jar, sessionOptions);
  session.authenticated = true;
  session.user = r.identity;
  await session.save();

  const res = NextResponse.redirect(new URL("/?bienvenida=1", here));
  res.cookies.delete(TX_COOKIE);
  return res;
}
```

⚠️ El `?bienvenida=1` es lo que sustituye al viejo flag de "acabo de entrar": el login
ya no es un submit dentro de la página, sino una navegación completa, así que el estado
de React no sobrevive. La página lo lee y **lo limpia de la URL** (Tarea 10, paso f)
para que un F5 no vuelva a ofrecer el recorrido.

- [ ] **Step 3: Verify the gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde.

- [ ] **Step 4: Configura Google Cloud (manual, una vez)**

1. Google Cloud Console → tu proyecto → **Google Auth Platform**: *Audience* con User type **External**, y **publicar** la app (en *Testing* hay cap de 100 usuarios). Scopes: sólo `openid`, `email`, `profile`.
2. *Credentials* → **Create credentials** → **OAuth client ID** → tipo **Web application**.
3. *Authorized redirect URIs*, exactos: `http://localhost:3000/api/auth/google/callback`.
4. Copia el Client ID y el secret a `.env.local`, reemplazando los `pendiente` de la Tarea 6.

- [ ] **Step 5: Pruébalo de verdad en el navegador**

Run: `npm run dev`

1. Abre `http://localhost:3000/api/auth/google` → debe llevarte al selector de cuentas de Google.
2. Entra con tu correo `@hiuman.edu.mx` → debe volver a `/` **ya autenticado** (se ve el menú, no la tarjeta de login).
3. Abre `http://localhost:3000/api/auth/session` → debe responder `{"authenticated":true,"user":{"email":"…","name":"…"}}`.
4. Prueba el rechazo: entra con una cuenta de Gmail personal → debe volver a `/?error=domain` y **seguir sin sesión**.

⚠️ **No sigas a la Tarea 10 hasta que estos cuatro pasos funcionen.** Esa tarea borra el login por password, que hasta aquí es tu vía de entrada de respaldo.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/auth/google/route.ts src/app/api/auth/google/callback/route.ts
git commit -m "feat(auth): rutas de autorización y callback de Google"
```

---

### Task 9: La ruta de stub para los E2E

**Files:**
- Create: `src/app/api/auth/stub-login/route.ts`
- Test: `tests/e2e/smoke.spec.ts` (un test nuevo)

**Interfaces:**
- Consumes: `SessionData`, `sessionOptions` (Tarea 7).
- Produces: `GET /api/auth/stub-login` → 302 a `/` con sesión de `e2e@hiuman.edu.mx`, o **404** sin `E2E_STUBS=1`.

- [ ] **Step 1: Write the failing test**

Añade a `tests/e2e/smoke.spec.ts`:

```ts
test("la ruta de stub-login sólo existe con E2E_STUBS", async ({ request }) => {
  // En esta suite la bandera está encendida, así que responde. El valor del test
  // es la aserción de arriba en CI y la de abajo como recordatorio: si algún día
  // esta ruta contesta en un entorno sin la bandera, es un agujero de auth.
  const r = await request.get("/api/auth/stub-login", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(process.env.E2E_STUBS).toBe("1");
});
```

Y en `tests/integration/auth-google.test.ts`, la guarda que de verdad importa:

```ts
import { NextRequest } from "next/server";
import { GET as stubLogin } from "@/app/api/auth/stub-login/route";

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
```

⚠️ Ambos casos se cortan **antes** de tocar `cookies()`, que lanzaría fuera de un
request de Next. Por eso el guard va en la primera línea de la ruta y no después de
leer la sesión: además de ser lo correcto, es lo que hace el test posible.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth-google.test.ts`
Expected: FAIL — no existe el módulo `@/app/api/auth/stub-login/route`.

- [ ] **Step 3: Write minimal implementation**

`src/app/api/auth/stub-login/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

/**
 * Entrada de los E2E: Playwright no puede hablar con Google real. Mismo modelo
 * de confianza que tenía la concesión de verifyPassword con E2E_STUBS, y misma
 * mitigación: sin la bandera esta ruta NO EXISTE (404), y E2E_STUBS nunca se
 * define en Vercel. Sin parámetros a propósito —correo fijo, nada que inyectar—.
 */
const STUB_USER = { email: "e2e@hiuman.edu.mx", name: "Usuario E2E" };

export async function GET(req: NextRequest) {
  if (process.env.E2E_STUBS !== "1") {
    return new NextResponse(null, { status: 404 });
  }
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.authenticated = true;
  session.user = STUB_USER;
  await session.save();
  // Contra el origin del request, NO contra APP_ORIGIN: el E2E corre en :3100 y
  // `next start` pisa el env heredado con .env.local, que dice :3000. Con
  // APP_ORIGIN, Playwright acabaría en otro server.
  return NextResponse.redirect(new URL("/", req.nextUrl.origin));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth-google.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/stub-login/route.ts tests/integration/auth-google.test.ts tests/e2e/smoke.spec.ts
git commit -m "feat(test): entrada de stub para los E2E, 404 sin la bandera"
```

---

### Task 10: La tarjeta de login, y fuera el password

⚠️ **Requisito:** el Step 5 de la Tarea 8 tiene que haber funcionado. Después de esta tarea, la única forma de entrar es Google.

**Files:**
- Modify: `src/app/page.tsx:63-138`
- Delete: `src/app/api/login/route.ts`
- Modify: `src/lib/auth.ts`, `tests/unit/auth.test.ts`, `package.json`

**Interfaces:**
- Consumes: `GET /api/auth/google` (Tarea 8).
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Write the failing test**

Añade a `tests/e2e/smoke.spec.ts`:

```ts
test("la tarjeta de login ofrece Google y traduce el error del callback", async ({ page }) => {
  await page.goto("/?error=domain");
  const boton = page.getByRole("link", { name: "Continuar con Google" });
  await expect(boton).toBeVisible();
  await expect(boton).toHaveAttribute("href", "/api/auth/google");
  // El mensaje no filtra el correo ni el error crudo de Google.
  await expect(page.getByText("Esa cuenta no está autorizada")).toBeVisible();
  // Ya no hay password que escribir.
  await expect(page.getByPlaceholder("Contraseña")).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- --workers=2 -g "ofrece Google"`
Expected: FAIL — no existe el link "Continuar con Google".

- [ ] **Step 3: Reescribe la rama de login de `page.tsx`**

En `src/app/page.tsx`:

a) En los imports: quita `Lock` de la línea 11 (`lucide-react`) y borra las líneas 16 y
17 completas (`Input` y `Label`) — el formulario de password era su **único** consumidor
en este archivo. `Spinner` (línea 13) **se queda**: lo usa la rama de carga en la línea
96. Agrega:

```ts
import { useSearchParams } from "next/navigation";
```

b) Borra los estados `password`, `loginErr`, `loggingIn` (líneas 65-67) y la función `login` completa (líneas 82-91).

c) Agrega, junto a los otros estados:

```ts
  const params = useSearchParams();
  const authError = ERROR_MESSAGES[params.get("error") ?? ""] ?? null;
```

d) Arriba del componente `Home`, agrega el mapa de mensajes y el logo:

```ts
// Los códigos que puede devolver /api/auth/google/callback. El mensaje NUNCA
// repite el correo ni el error crudo de Google: quien no está autorizado no
// necesita saber qué parte de la validación lo rechazó.
const ERROR_MESSAGES: Record<string, string> = {
  domain: "Esa cuenta no está autorizada. Entra con tu correo institucional.",
  unverified: "Esa cuenta de Google tiene el correo sin verificar.",
  state: "La sesión de ingreso venció. Inténtalo de nuevo.",
  token: "No se pudo completar el ingreso con Google. Inténtalo de nuevo.",
  google: "Se canceló el ingreso con Google.",
  rate: "Demasiados intentos, espera 15 minutos.",
};

/** La "G" de Google en línea: sus lineamientos de marca piden el logo junto al
 *  texto, y embebido no cuesta una petición externa ni depende de su CDN. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4 shrink-0" aria-hidden>
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.6h11.9c-.2 2-1.5 4.9-4.4 6.9l-.1.3 6.4 5 .4.1c4.1-3.8 6.9-9.3 6.9-15.9z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.8-1.9 14.2-5.3l-6.8-5.2c-1.8 1.3-4.3 2.2-7.4 2.2-5.7 0-10.5-3.7-12.2-8.8l-.3.1-6.6 5.1-.1.3C8.2 41.1 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.9c-.5-1.4-.7-2.8-.7-4.4s.3-3 .7-4.4l-.1-.3-6.7-5.2-.2.1C3.2 17.5 2.4 20.6 2.4 24s.8 6.5 2.4 9.3l7-4.4z" />
      <path fill="#EA4335" d="M24 9.8c4 0 6.7 1.7 8.3 3.2l6-5.9C34.7 3.7 29.9 2 24 2 15.5 2 8.2 6.9 4.8 14.7l7 5.4C13.5 15 18.3 9.8 24 9.8z" />
    </svg>
  );
}
```

e) Reemplaza la `<Card>` de la rama `!authed` (líneas 115-134) por:

```tsx
        <Card className="w-full max-w-sm space-y-3.5 p-6">
          {authError && (
            <p role="alert" className="text-sm font-medium text-danger">{authError}</p>
          )}
          {/* Link con navegación real, no fetch: el flujo de OAuth es una
              redirección del navegador y un XHR no la puede seguir. */}
          <Button asChild className="h-10 w-full">
            <a href="/api/auth/google">
              <GoogleMark />
              Continuar con Google
            </a>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Sólo cuentas de los dominios autorizados de iU Corp.
          </p>
        </Card>
```

f) `justLoggedIn` ya no lo puede prender un submit propio: el login ahora ocurre en una
navegación completa y el estado de React no sobrevive. **El estado de la línea 69 se
queda tal cual** (y su `setJustLoggedIn(false)` del `onLogout` de la línea 143 también);
lo que cambia es quién lo prende. Agrega, junto a los otros efectos:

```ts
  // El callback de Google vuelve con ?bienvenida=1: es lo único que distingue
  // "acabo de entrar" de "recargué con la cookie viva". Se lee una vez y se
  // limpia de la URL — si el parámetro se quedara, cada F5 volvería a ofrecer el
  // recorrido, que es justo lo que la key de localStorage evita.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (params.get("bienvenida") !== "1") return;
    setJustLoggedIn(true);
    window.history.replaceState({}, "", "/");
  }, [params]);
```

El redirect con `?bienvenida=1` ya lo hace el callback de la Tarea 8; aquí sólo se
consume.

- [ ] **Step 4: Borra el login por password**

```bash
git rm src/app/api/login/route.ts
```

`src/lib/auth.ts` queda entero así:

```ts
// Única definición de sesión: src/lib/session.ts. Este archivo sólo re-exporta
// para que los consumidores viejos no cambien de import. Antes agregaba
// verifyPassword (bcrypt); el login pasó a Google (ADR-0008) y no queda password.
export { sessionOptions, type SessionData, type SessionUser } from "./session";
```

En `tests/unit/auth.test.ts`, borra el import de `bcryptjs` y de `verifyPassword`, el `beforeAll` con el hash y todo el `describe("verifyPassword")`. Queda:

```ts
import { describe, it, expect } from "vitest";
import { sessionOptions } from "@/lib/auth";

describe("sessionOptions", () => {
  it("expone opciones httpOnly y cookieName", () => {
    expect(sessionOptions.cookieOptions?.httpOnly).toBe(true);
    expect(sessionOptions.cookieName).toBe("export-notion-session");
  });
});
```

Y quita la dependencia:

```bash
npm uninstall bcryptjs
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde. Si `tsc` señala un import de `bcryptjs` o de `verifyPassword`, quedó un consumidor sin limpiar.

Run: `npm run test:e2e -- --workers=2 -g "ofrece Google"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): la tarjeta de login entra por Google y sale el password"
```

---

### Task 11: El shell muestra quién eres

**Files:**
- Modify: `src/app/components/app-shell.tsx:109-110,193-200,313-327`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `GET /api/auth/session` (Tarea 7), `POST /api/auth/logout` (Tarea 7).
- Produces: nada.

- [ ] **Step 1: Write the failing test**

Añade a `tests/e2e/smoke.spec.ts` (usa el `login()` que la Tarea 12 va a actualizar; hasta entonces este test se escribe pero corre en la Tarea 12):

```ts
test("el footer del shell identifica a quien inició sesión", async ({ page }) => {
  await login(page);
  const footer = page.getByRole("complementary", { name: "Navegación" });
  await expect(footer.getByText("Usuario E2E")).toBeVisible();
  await expect(footer.getByText("e2e@hiuman.edu.mx")).toBeVisible();
  // Ya no dice sólo "Sesión activa".
  await expect(footer.getByText("Sesión activa")).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- --workers=2 -g "identifica a quien"`
Expected: FAIL — el footer dice "Sesión activa".

- [ ] **Step 3: Pide la identidad**

En `src/app/components/app-shell.tsx`, junto a `const [count, setCount] = useState<number | null>(null);` (línea 110):

```ts
  const [user, setUser] = useState<SessionUser | null>(null);
```

Agrega el import:

```ts
import type { SessionUser } from "@/lib/session";
```

Y un efecto junto al del contador (después de la línea 114):

```ts
  // El shell sólo se monta autenticado, así que esta respuesta siempre trae
  // usuario. Es el único consumidor de la identidad en toda la app: por eso la
  // pide él y no se le pasa por props desde las tres páginas.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/auth/session");
        if (!r.ok) return;
        const j = (await r.json()) as { user?: SessionUser | null };
        if (alive && j.user) setUser(j.user);
      } catch { /* sin identidad el footer cae al correo vacío, no rompe */ }
    })();
    return () => { alive = false; };
  }, []);
```

- [ ] **Step 4: Cambia el logout**

En `logout()` (línea 197), reemplaza:

```ts
      await fetch("/api/login", { method: "DELETE" });
```

por:

```ts
      await fetch("/api/auth/logout", { method: "POST" });
```

- [ ] **Step 5: Reescribe el footer**

Reemplaza el contenido del `<div>` del footer (líneas 314-316, el punto verde y el `<span>` de "Sesión activa") por:

```tsx
          {/* Iniciales en vez de la foto de Google: la imagen vive en
              lh3.googleusercontent.com, lo que obliga a declarar
              images.remotePatterns y dispara una petición externa en cada carga.
              El nombre cae al correo cuando Google no manda `name`. */}
          <span aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
            {initials(user?.name ?? user?.email ?? "")}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-xs text-sidebar-foreground">{user?.name ?? "Sesión activa"}</span>
            {user?.email && <span className="truncate text-[10.5px] text-subtle">{user.email}</span>}
          </span>
```

Y arriba del componente `AppShell`, la función:

```ts
/** Hasta dos iniciales. Un correo sin espacios da una sola, que es correcto:
 *  inventar la segunda a partir del dominio produciría "PH" para pablo@hiuman. */
function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("");
}
```

- [ ] **Step 6: Verify the gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde. (El E2E de esta tarea se corre en la Tarea 12, cuando `login()` ya entra por el stub.)

- [ ] **Step 7: Commit**

```bash
git add src/app/components/app-shell.tsx tests/e2e/smoke.spec.ts
git commit -m "feat(shell): mostrar en el footer quién inició sesión"
```

---

### Task 12: Los E2E entran por el stub

**Files:**
- Modify: `tests/e2e/helpers.ts:1-28`

**Interfaces:**
- Consumes: `GET /api/auth/stub-login` (Tarea 9).
- Produces: `login(page, opts?)` con la misma firma que antes, para que los 31 tests existentes no cambien.

- [ ] **Step 1: Reescribe `login()`**

`tests/e2e/helpers.ts`, reemplazando la constante y la función:

```ts
import { expect, type Page } from "@playwright/test";

/**
 * Login del entorno stub.
 *
 * Navega a /api/auth/stub-login, que sólo existe con E2E_STUBS=1 y escribe la
 * sesión directo: Playwright no puede completar el flujo real de Google. La ruta
 * redirige a /, así que al volver ya estamos en el menú.
 *
 * welcome: "skip" (default) siembra el estado del onboarding ANTES de cargar la
 * página, así el modal de bienvenida no aparece y no intercepta los clicks de
 * los tests que no van sobre el onboarding. "expect" lo deja aparecer.
 */
export async function login(page: Page, opts: { welcome?: "skip" | "expect" } = {}): Promise<void> {
  if ((opts.welcome ?? "skip") === "skip") {
    await page.addInitScript(() => {
      window.localStorage.setItem("onboarding-v1", JSON.stringify({ welcomeSeen: true }));
    });
  }
  await page.goto("/api/auth/stub-login");
  // Esperar el shell autenticado, no sólo la navegación: sin esto el helper
  // regresa antes de que la página termine de montar su rama con sesión, y un
  // test que interactúe de inmediato corre contra el "Cargando…".
  await expect(page.getByRole("complementary", { name: "Navegación" })).toBeAttached();
  if ((opts.welcome ?? "skip") === "skip") {
    await expect(page.getByTestId("welcome-modal")).toBeHidden();
  }
}
```

- [ ] **Step 2: Corre la suite E2E completa**

Run: `npm run test:e2e -- --workers=2`
Expected: PASS, los 34 tests (31 previos + los 3 nuevos de las Tareas 9, 10 y 11).

⚠️ Si algún test del onboarding falla por el aviso de bienvenida: el `justLoggedIn` ahora depende de `?bienvenida=1` (Tarea 10, paso f-g) y el stub redirige a `/` **sin** ese parámetro. Es correcto: el aviso sólo debe salir tras un login real. Si un test del onboarding esperaba el aviso, hazlo navegar a `/?bienvenida=1` después de `login(page)`.

⚠️ Si ves `MODULE_UNPARSABLE` sobre `src/instrumentation.ts`: hay un `npm run dev` abierto escribiendo en el mismo `.next`. Corta el dev server, `Remove-Item .next -Recurse -Force` y repite.

- [ ] **Step 3: Verify the gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers.ts
git commit -m "test(e2e): entrar por el stub de sesión en vez del password"
```

---

### Task 13: Documentación y ADR

**Files:**
- Create: `docs/architecture/adr/0008-login-con-google-sobre-iron-session.md`
- Modify: `CLAUDE.md`, `README.md`, `docs/guides/deploy.md`, `docs/superpowers/specs/2026-08-07-login-con-google-design.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Escribe el ADR**

`docs/architecture/adr/0008-login-con-google-sobre-iron-session.md`:

```markdown
# ADR 0008 — Login con Google escrito a mano sobre iron-session

**Fecha:** 2026-08-07 · **Estado:** aceptado

## Contexto

La app entraba con un password compartido (bcrypt contra `APP_PASSWORD_HASH`) y una
cookie iron-session que sólo decía `{authenticated: true}`. No había identidad: ni
para mostrar quién está dentro, ni para restringir por dominio, ni para auditar.
Se necesitaba login con Google, con **varios dominios** autorizados.

## Decisión

OAuth 2.0 Authorization Code + PKCE escrito en el repo (`src/lib/google-oauth.ts`),
sobre la misma iron-session. La sesión conserva `authenticated` y **suma**
`user: {email, name}`.

Un solo proyecto de Google Cloud con la pantalla de consentimiento **External** y
publicada: el Client ID identifica la app, no el dominio de quien entra, así que
varios dominios no exigen varios proyectos. La restricción es nuestra, validando el
`email` del ID token contra `ALLOWED_EMAIL_DOMAINS`.

## Alternativas descartadas

**Auth.js (NextAuth v5)** trae su propia sesión y su propia cookie: adoptarla obliga a
reescribir `src/proxy.ts` y cada `getIronSession` de las rutas de API — un cambio más
grande que el feature — y los E2E tendrían que stubear otra sesión. `next-auth@5` lleva
años en beta y su compatibilidad con Next 16 habría que verificarla. Lo que resolvería
aquí (un proveedor, sin refresh tokens, sin gestión de usuarios) son las ~60 líneas que
menos cuestan. Se reconsideraría con más proveedores, magic links o sesiones por
dispositivo.

**Supabase Auth** metería `@supabase/supabase-js` + `@supabase/ssr` y un segundo
sistema de sesión, cuando hoy Supabase es **sólo Postgres** aquí (ADR-0007), además de
su gestión de usuarios, que quedó fuera de alcance.

## Consecuencias

- Sale `bcryptjs`; `APP_PASSWORD_HASH` deja de existir. Las env vars obligatorias pasan
  de 7 a 10.
- **No se verifica la firma del `id_token`.** Vale porque el token llega del canje
  directo con Google por TLS: el canal autentica el origen. ⚠️ Si algún día se acepta
  un `id_token` por otra vía, hay que verificar la firma con JWKS.
- **Los previews de Vercel se quedan sin login**: su URL es aleatoria y Google no
  acepta comodines en los redirect URIs.
- **Sin revocación:** quitarle el acceso a alguien no invalida su cookie, que vive hasta
  7 días. Cerrarlo requiere validar contra una lista en cada request, y con ella la
  tabla de usuarios que se dejó fuera de alcance.
- `rateLimitLogin` y la tabla `login_attempts` se conservan, protegiendo el callback:
  cada callback con un `code` inventado hace que nuestra función salga a hablar con
  Google.
```

- [ ] **Step 2: Actualiza `CLAUDE.md`**

a) En la sección **Auth**, reemplaza el bloque de dos viñetas por:

```markdown
- **`src/proxy.ts`** (convención Next 16, ex-`middleware.ts`; runtime nodejs) protege `/api/export/*`, `/api/sync/status`, `/api/reports/*` y `/api/chat` con iron-session. **`/api/sync` no está en el matcher** — su auth (cookie OR cron bearer) la maneja la route handler. **`/api/auth/session` tampoco**: tiene que contestar `{authenticated:false}` sin sesión en vez de 401.
- **Login con Google** (ADR-0008), única puerta: no hay password. `src/lib/google-oauth.ts` tiene TODO el flujo (state, PKCE S256, cookie sellada `oauth-tx` de 10 min, canje del code, lectura del ID token, allowlist) **sin importar nada de Next**, y `resolveCallback()` es el orquestador puro — la route handler sólo traduce HTTP, porque `cookies()` lanza fuera de un request y la orquestación se quedaría sin tests. ⚠️ **No se verifica la firma del `id_token`**: llega del canje directo por TLS, el canal autentica el origen. Si algún día llega por otra vía, hay que verificarla. La restricción por dominio es **nuestra**, en `ALLOWED_EMAIL_DOMAINS` (comparación exacta: subdominio no listado NO entra; lista vacía = nadie entra); el claim `hd` de Google es sólo una pista y no se usa. Un solo proyecto de Google Cloud alcanza para varios dominios: el consent screen va **External** y publicado, y el Client ID identifica la app, no el dominio.
- **Única definición de sesión**: `src/lib/session.ts` (opciones + tipo `SessionData {authenticated?, user?}`). `src/lib/auth.ts` sólo la re-exporta. `SESSION_SECRET` no tiene fallback: si falta, el fail-fast de `instrumentation.ts` impide arrancar.
- ⚠️ **`GET /api/auth/stub-login`** emite una sesión sin credenciales para que Playwright pueda entrar. Sólo existe con `E2E_STUBS=1` (404 si no), sin parámetros, con correo fijo. Cubierto por un test de que da 404 sin la bandera.
```

b) En **Endpoints**, borra la línea de `POST /api/login` y agrega:

```markdown
- `GET /api/auth/google` — arranca el flujo: state + PKCE en la cookie `oauth-tx`, 302 a Google. `GET /api/auth/google/callback` — valida y crea la sesión; redirige a `/?bienvenida=1` o a `/?error=<state|google|token|unverified|domain|rate>`. Rate-limit 5/15min por IP sobre el callback (tabla `login_attempts`).
- `GET /api/auth/session` — `{authenticated, user?}`; **fuera** del matcher del proxy. `POST /api/auth/logout` — destruye la sesión.
```

c) En **`src/lib/config.ts`**, cambia "exige las **7** env vars (`NOTION_TOKEN`, `NOTION_DATABASE_ID`, `DATE_COLUMN`, `APP_PASSWORD_HASH`, `SESSION_SECRET`, `CRON_SECRET`, `DATABASE_URL`)" por "exige las **10** env vars (`NOTION_TOKEN`, `NOTION_DATABASE_ID`, `DATE_COLUMN`, `SESSION_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS`, `APP_ORIGIN`)".

d) En el bloque de **Comandos**, en la nota del E2E stub, cambia "password fijo `e2e-password` en `verifyPassword`" por "`GET /api/auth/stub-login`, que sólo existe con la bandera".

e) En **Convenciones**, borra la viñeta de `APP_PASSWORD_HASH` con los `\$` escapados.

f) En **Páginas (UI)**, en la línea de `/`, cambia "login + **menú principal**" por "login con Google + **menú principal**".

- [ ] **Step 3: Actualiza `README.md` y `docs/guides/deploy.md`**

Son siete menciones, ya localizadas. Verifica que no aparecieron más:

```bash
git grep -n -E "APP_PASSWORD_HASH|bcrypt|[Cc]ontrase" -- README.md docs/guides/deploy.md
```

En `README.md`:

- **Líneas 18-20** (el paso "Genera el hash bcrypt del password compartido" con su
  `node -e`): reemplázalo por los cuatro pasos de Google Cloud del Step 4 de la Tarea 8.
- **Línea 61** (lista de env vars de Vercel): quita `APP_PASSWORD_HASH` **literal, …** y
  pon `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS` y `APP_ORIGIN`
  (este último con el dominio de producción, no `localhost`).
- **Línea 78** (`Password compartido (bcrypt) + cookie httpOnly firmada`): cambia a
  `Login con Google (OAuth 2.0 + PKCE, dominios en allowlist) + cookie httpOnly firmada
  (iron-session)`.

En `docs/guides/deploy.md`:

- **Líneas 45-46** (`# APP_PASSWORD_HASH — el password compartido del equipo` y el
  `node -e` con `bcryptjs`): reemplázalas por los cuatro pasos de Google Cloud.
- **Línea 62** (fila de la tabla de env vars de Vercel): cambia la de
  `APP_PASSWORD_HASH` por cuatro filas, una por var nueva.
- **Línea 69** (la nota de los `\$` escapados): bórrala — sin hash bcrypt no hay `$` que
  escapar, y era la única razón de esa advertencia.

Y agrega los tres avisos de operación en la sección de despliegue de `deploy.md`:

```markdown
> **Borra `APP_PASSWORD_HASH` de Vercel a mano** — el código no toca esa configuración.
>
> **Rota `SESSION_SECRET` al desplegar.** Si no, las cookies emitidas con el password
> siguen válidas hasta 7 días y pasan el proxy **sin traer `user`**, justo lo que este
> cambio elimina. Rotarlo obliga a todos a entrar de nuevo, que es el punto.
>
> **Los previews de Vercel se quedan sin login**: su URL es aleatoria y Google no acepta
> comodines en los redirect URIs. Registra el dominio de producción y usa local para probar.
```

- [ ] **Step 4: Corrige el spec**

En `docs/superpowers/specs/2026-08-07-login-con-google-design.md`, sección **Errores**, agrega `rate` a la lista de códigos: el rate-limit del callback necesita el suyo y el spec lo omitió.

- [ ] **Step 5: Verify the gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde.

Run: `npm run test:e2e -- --workers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(auth): documentar el login con Google y el ADR 0008"
```

---

## Cierre de la rama

- [ ] **Revisa el diff completo** contra `main`: `git diff main...feat/google-login`
- [ ] **Corre `/review`** sobre el diff y reporta lo que afecte corrección o los requisitos declarados.
- [ ] **Abre el PR** con `gh pr create`, describiendo qué cambia, por qué, y cómo verificarlo — incluyendo los cuatro pasos manuales de Google Cloud, porque **el PR no se puede probar sin ellos**.
- [ ] **Antes de mergear a producción:** registra el redirect URI del dominio de Vercel, pon las cuatro env vars en Vercel, borra `APP_PASSWORD_HASH` y rota `SESSION_SECRET`.
