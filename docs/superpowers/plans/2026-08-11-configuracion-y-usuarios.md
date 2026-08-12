# Panel de configuración y gestión de usuarios — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un panel de configuración que se abre desde el footer de la sesión, con una sección Usuarios —sólo para admins— donde se cambian roles y se borran filas.

**Architecture:** El menú del footer de `AppShell` abre un modal centrado con secciones. La sección Usuarios habla con un endpoint nuevo, `/api/admin/users`, protegido por el proxy (sesión) y por un gate de rol en la handler. Las decisiones de permiso son funciones puras en `authz.ts` que corren igual en el cliente (para mostrar u ocultar) y en el server (para autorizar).

**Tech Stack:** Next.js 16 App Router · shadcn/ui sobre Radix · postgres.js · iron-session · Vitest · Playwright

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-11-configuracion-y-usuarios-design.md`. Ante una duda no cubierta acá, manda el spec.
- **No hay migración nueva.** La tabla `users` ya tiene las cinco columnas que esto necesita.
- **El rol NO se sella en la sesión.** `SessionData` no cambia. Se lee de la tabla en cada request.
- **`src/lib/authz.ts` no importa nada de Next.** Es lo que le permite correr en el cliente.
- **Los controles vedados van con `aria-disabled` y sin `onClick`, nunca con `disabled`:** un control deshabilitado no emite eventos de puntero y su tooltip no aparecería.
- **Gate de permisos sin `try/catch`.** En `/api/admin/users` un error de base tiene que cerrar la puerta. El `try/catch` es sólo para lecturas de rol decorativas (`/api/auth/session`, `/api/sync/status`).
- **Texto de la UI en español**, con acentos correctos.
- **Gate antes de dar algo por terminado:** `npm test && npm run lint && npx tsc --noEmit`, mostrando la salida real.
- **Commits pequeños**, mensaje en imperativo, asunto ≤72 caracteres.

---

### Task 1: Reglas puras de administración de usuarios

**Files:**
- Modify: `src/lib/authz.ts`
- Test: `tests/unit/authz.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail(email: string): string` y `type Role = "admin" | "viewer"`, ya en `authz.ts`.
- Produces: `canManageUsers(role: Role): boolean` y `canEditUser(actorEmail: string, targetEmail: string): boolean`.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `tests/unit/authz.test.ts`, y agregar los dos nombres nuevos al `import` de la línea 2:

```ts
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/authz.test.ts`
Expected: FAIL — `canManageUsers is not a function` / error de TypeScript por el import inexistente.

- [ ] **Step 3: Implementar**

Agregar al final de `src/lib/authz.ts`:

```ts
/** La pantalla de usuarios es de admin. La misma función decide si la sección se
 *  dibuja (cliente) y si el endpoint responde (server): una sola regla, dos usos. */
export function canManageUsers(role: Role): boolean {
  return role === "admin";
}

/** Nadie opera sobre su propia fila —ni el rol ni el borrado—. La consecuencia
 *  buscada es que NUNCA pueda quedar cero admins: quien administra no puede
 *  sacarse a sí mismo, así que no hace falta contar admins ni una regla de
 *  "último admin". Compara normalizado: si no, `Pablo@` se degradaría a sí mismo. */
export function canEditUser(actorEmail: string, targetEmail: string): boolean {
  return normalizeEmail(actorEmail) !== normalizeEmail(targetEmail);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/authz.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/authz.ts tests/unit/authz.test.ts
git commit -m "feat(authz): reglas de administracion de usuarios"
```

---

### Task 2: `listUsers` y `deleteUser` en el Store

**Files:**
- Modify: `src/lib/store-shared.ts` (tipo `UserRow` + dos métodos en `interface Store`)
- Modify: `src/lib/db.ts` (implementación Postgres + wrappers exportados)
- Modify: `src/lib/memory-store.ts` (implementación en memoria)
- Modify: `tests/fixtures/userCases.ts` (casos compartidos)
- Modify: `tests/integration/db.pg.test.ts:193-207` (las aserciones posteriores a `runUserAssertions`)

**Interfaces:**
- Consumes: `normalizeEmail`, `type Role` de `authz.ts`; el patrón de wrappers de `db.ts:390-392`.
- Produces:
  - `interface UserRow { email: string; role: Role; name: string | null; createdAt: string; lastLoginAt: string | null }`
  - `listUsers(): Promise<UserRow[]>` — orden: `last_login_at` descendente, los que nunca entraron al final, desempate por email.
  - `deleteUser(email: string): Promise<void>` — normaliza en la frontera; borrar a alguien inexistente es un no-op.

- [ ] **Step 1: Escribir los casos compartidos que fallan**

Agregar al final de `runUserAssertions` en `tests/fixtures/userCases.ts` (después de la línea 30):

```ts
  // listUsers: dos filas, no cuatro. El correo se escribió con tres grafías
  // distintas y el upsert las colapsó; si esto diera 3 o 4, la normalización de
  // la frontera se habría roto.
  const list = await db.listUsers();
  expect(list.map((u) => u.email)).toEqual(["pablo@hiuman.edu.mx", "futuro@hiuman.edu.mx"]);
  // Orden: primero quien entró, al final quien nunca lo hizo (nulls last).
  expect(list[0].lastLoginAt).not.toBeNull();
  expect(list[1].lastLoginAt).toBeNull();
  // El segundo login refrescó el nombre; el rol es el que dejó la degradación.
  expect(list[0]).toMatchObject({ role: "viewer", name: "Pablo Sánchez" });
  expect(list[0].createdAt).not.toBeNull();
  // Quien nunca entró no tiene nombre: null, no "". El SQL guarda null y el
  // stub tiene que decir lo mismo o la tabla de la UI mostraría comillas vacías.
  expect(list[1]).toMatchObject({ role: "admin", name: null });

  // deleteUser normaliza igual que el resto de la frontera…
  await db.deleteUser("PABLO@hiuman.edu.mx");
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBeNull();
  // …borra sólo a quien se le pide…
  expect((await db.listUsers()).map((u) => u.email)).toEqual(["futuro@hiuman.edu.mx"]);
  // …y borrar a alguien que ya no está es un no-op, no un error.
  await db.deleteUser("pablo@hiuman.edu.mx");
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/users.memory.test.ts`
Expected: FAIL — `db.listUsers is not a function`.

- [ ] **Step 3: Declarar el tipo y los métodos en la interfaz**

En `src/lib/store-shared.ts`, agregar antes de `export interface Store` (línea 103):

```ts
/** Fila de `users` tal como la consume la pantalla de administración. */
export interface UserRow {
  email: string;
  role: Role;
  /** null = nunca entró, o Google no mandó nombre. */
  name: string | null;
  createdAt: string;
  /** null = tiene fila (la creó setUserRole) pero nunca hizo login. */
  lastLoginAt: string | null;
}
```

Y dentro de `interface Store`, justo después de `setUserRole` (línea 135):

```ts
  /** Todas las filas, las más recientes primero y las que nunca entraron al final. */
  listUsers(): Promise<UserRow[]>;
  /** No quita el acceso: la puerta es ALLOWED_EMAIL_DOMAINS y recordLogin recrea
   *  la fila —como viewer— en el próximo login. Sí quita el rol. */
  deleteUser(email: string): Promise<void>;
```

- [ ] **Step 4: Implementar en Postgres**

En `src/lib/db.ts`, agregar dentro del objeto `pgStore` justo después de `setUserRole` (línea 320), y sumar `UserRow` al import de `@/lib/store-shared`:

```ts
    async listUsers() {
      const rs = await sql`
        select email, role, name, created_at, last_login_at from users
        order by last_login_at desc nulls last, email`;
      return rs.map((r): UserRow => ({
        email: r.email as string,
        role: r.role as Role,
        name: (r.name as string | null) ?? null,
        createdAt: (r.created_at as Date).toISOString(),
        lastLoginAt: r.last_login_at ? (r.last_login_at as Date).toISOString() : null,
      }));
    },
    async deleteUser(email) {
      await sql`delete from users where email = ${normalizeEmail(email)}`;
    },
```

Y los wrappers exportados, después de la línea 392:

```ts
export const listUsers: Store["listUsers"] = () => s().listUsers();
export const deleteUser: Store["deleteUser"] = (e) => s().deleteUser(e);
```

- [ ] **Step 5: Implementar en memoria**

En `src/lib/memory-store.ts`: sumar `type UserRow` al import de `@/lib/store-shared`, cambiar el tipo del mapa (línea 253) para que el nombre pueda ser nulo, y ajustar `setUserRole` para crear con `name: null`:

```ts
  private users = new Map<string, { role: Role; name: string | null; createdAt: string; lastLoginAt: string | null }>();
```

```ts
  async setUserRole(email: string, role: Role): Promise<void> {
    const key = normalizeEmail(email);
    const cur = this.users.get(key);
    if (cur) { cur.role = role; return; }
    // name null y no "": el SQL deja la columna nula cuando la fila no nació de
    // un login, y el stub tiene que decir lo mismo.
    this.users.set(key, { role, name: null, createdAt: new Date().toISOString(), lastLoginAt: null });
  }
```

Y los dos métodos nuevos, antes del cierre de la clase:

```ts
  async listUsers(): Promise<UserRow[]> {
    // Mismo orden que el SQL: last_login_at DESC NULLS LAST, desempate por email.
    return [...this.users.entries()]
      .map(([email, u]) => ({ email, ...u }))
      .sort((a, b) => {
        if (a.lastLoginAt === b.lastLoginAt) return a.email < b.email ? -1 : 1;
        if (a.lastLoginAt === null) return 1;
        if (b.lastLoginAt === null) return -1;
        return a.lastLoginAt < b.lastLoginAt ? 1 : -1;
      });
  }

  async deleteUser(email: string): Promise<void> {
    this.users.delete(normalizeEmail(email));
  }
```

- [ ] **Step 6: Correr el test de memoria y verificar que pasa**

Run: `npx vitest run tests/integration/users.memory.test.ts`
Expected: PASS.

- [ ] **Step 7: Ajustar el test de Postgres real, que ahora contradice a los casos compartidos**

`tests/integration/db.pg.test.ts:193-207` afirma que después de `runUserAssertions` quedan **2** filas y que existe la de `pablo@`. Los casos nuevos borran esa fila al final, así que esas aserciones ya no describen el estado. Reemplazar ese `it` entero por:

```ts
  it("users: los casos compartidos pasan contra el SQL real", async () => {
    await runUserAssertions(db);
    // Que las tres grafías del correo colapsaran en UNA fila ya lo afirma el
    // listUsers de userCases (dos filas, no cuatro) antes del borrado; acá sólo
    // se verifica que el DELETE real dejó exactamente lo que debía quedar.
    const rs = await sql`select * from users`;
    expect(rs).toHaveLength(1);
    expect(rs[0].email).toBe("futuro@hiuman.edu.mx");
    expect(rs[0].last_login_at).toBeNull();   // tiene fila, nunca entró
    expect(rs[0].created_at).not.toBeNull();
  });
```

Este archivo está gated por `TEST_DATABASE_URL` y en una corrida normal se saltea. **No lo corras contra la base del app**: dropea y trunca tablas.

- [ ] **Step 8: Correr la suite entera y el typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, sin errores de tipos. `db.pg.test.ts` aparece como skipped.

- [ ] **Step 9: Commit**

```bash
git add src/lib/store-shared.ts src/lib/db.ts src/lib/memory-store.ts tests/fixtures/userCases.ts tests/integration/db.pg.test.ts
git commit -m "feat(db): listUsers y deleteUser en el Store"
```

---

### Task 3: Endpoint `/api/admin/users`

**Files:**
- Create: `src/app/api/admin/users/route.ts`
- Modify: `src/proxy.ts`
- Test: `tests/integration/admin-users.test.ts`

**Interfaces:**
- Consumes: `canManageUsers`, `canEditUser`, `roleOrDefault`, `type Role` (Task 1); `listUsers`, `deleteUser`, `getUserRole`, `setUserRole` (Task 2).
- Produces: `GET → {users: UserRow[]}`, `PATCH {email, role} → {ok:true}`, `DELETE ?email= → {ok:true}`. Errores: 403 `forbidden`, 400 `bad_request`, 400 `bad_role`, 409 `self`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/integration/admin-users.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/admin-users.test.ts`
Expected: FAIL — no se puede resolver el módulo `@/app/api/admin/users/route`.

- [ ] **Step 3: Implementar la handler**

Crear `src/app/api/admin/users/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { listUsers, deleteUser, getUserRole, setUserRole } from "@/lib/db";
import { canEditUser, canManageUsers, roleOrDefault, type Role } from "@/lib/authz";

export const dynamic = "force-dynamic";

const ROLES = new Set<string>(["admin", "viewer"]);

/**
 * El correo de quien pide, si puede administrar; null si no.
 *
 * ⚠️ SIN try/catch a propósito, al revés que /api/auth/session y el callback de
 * Google: este es el punto que DECIDE un permiso, así que un error de base tiene
 * que cortar la petición (500) y no degradar a "pasá". El fail-open acá regalaría
 * la administración de usuarios ante cualquier hipo de la base.
 *
 * La ruta está en el matcher de proxy.ts, así que llegar sin sesión ya es 401;
 * el null de acá cubre la sesión sin email (cookie previa a ADR-0008) y al viewer.
 */
async function actor(): Promise<string | null> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const email = session.user?.email;
  if (!email) return null;
  const role = roleOrDefault(await getUserRole(email));
  return canManageUsers(role) ? email : null;
}

const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

export async function GET() {
  if (!(await actor())) return forbidden();
  return NextResponse.json({ users: await listUsers() });
}

export async function PATCH(req: NextRequest) {
  const me = await actor();
  if (!me) return forbidden();

  const body = (await req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role;
  if (!email) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (typeof role !== "string" || !ROLES.has(role)) {
    return NextResponse.json({ error: "bad_role" }, { status: 400 });
  }
  // Nadie se degrada a sí mismo: de ahí sale que nunca queden cero admins.
  if (!canEditUser(me, email)) return NextResponse.json({ error: "self" }, { status: 409 });

  // setUserRole crea la fila si no existe, igual que scripts/set-role.cjs. La UI
  // no expone esa vía (no hay campo para escribir correos) y crear una fila no le
  // da acceso a nadie —la puerta es el dominio—, así que no se prohíbe.
  await setUserRole(email, role as Role);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const me = await actor();
  if (!me) return forbidden();

  const email = req.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!canEditUser(me, email)) return NextResponse.json({ error: "self" }, { status: 409 });

  await deleteUser(email);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Sumar la ruta al proxy**

En `src/proxy.ts`, agregar `/api/admin` al array `PROTECTED` (línea 5) y `"/api/admin/:path*"` al `matcher` (línea 21):

```ts
const PROTECTED = ["/api/export", "/api/sync/status", "/api/reports", "/api/chat", "/api/admin"];
```

```ts
  matcher: ["/api/export/:path*", "/api/sync/status", "/api/reports/:path*", "/api/chat", "/api/chat/:path*", "/api/admin/:path*"],
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/integration/admin-users.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Verificar que el mock no se filtró a otras suites**

Run: `npm test`
Expected: PASS. En particular `tests/integration/sync-authz.test.ts` y `callback-registro.test.ts` siguen verdes: cada archivo tiene sus propios mocks de `iron-session`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/users/route.ts src/proxy.ts tests/integration/admin-users.test.ts
git commit -m "feat(api): endpoint de administracion de usuarios"
```

---

### Task 4: `/api/auth/session` devuelve el rol

**Files:**
- Create: `src/lib/user-role.ts`
- Modify: `src/app/api/auth/session/route.ts`
- Modify: `src/app/api/sync/status/route.ts:14-26` (pasa a usar el helper)
- Test: `tests/integration/session-role.test.ts`

**Interfaces:**
- Consumes: `roleOrDefault`, `type Role` de `authz.ts`; `getUserRole` de `db.ts`.
- Produces: `safeRoleFor(email: string | undefined): Promise<Role>` en `src/lib/user-role.ts`, y el campo `role` en la respuesta de `/api/auth/session`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/integration/session-role.test.ts`:

```ts
// El shell decide con esto si dibuja la sección Usuarios, así que el rol tiene
// que viajar en la respuesta de la sesión — leído de la tabla, no de la cookie.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __setStore, setUserRole, recordLogin } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";

const h = vi.hoisted(() => ({
  sesion: {} as { authenticated?: true; user?: { email: string; name: string } },
}));
vi.mock("iron-session", () => ({ getIronSession: async () => h.sesion }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

const { GET } = await import("@/app/api/auth/session/route");
const get = async () => (await GET()).json();

beforeEach(() => {
  __setStore(newMemoryStore());
  h.sesion = {};
});

describe("GET /api/auth/session", () => {
  it("sin sesión no toca la base ni inventa rol", async () => {
    const store = newMemoryStore();
    store.getUserRole = async () => { throw new Error("no debería consultarse"); };
    __setStore(store);
    expect(await get()).toEqual({ authenticated: false });
  });

  it("con fila admin devuelve admin", async () => {
    await setUserRole("jefa@hiuman.edu.mx", "admin");
    h.sesion = { authenticated: true, user: { email: "jefa@hiuman.edu.mx", name: "Jefa" } };
    expect((await get()).role).toBe("admin");
  });

  it("sin fila cae a viewer", async () => {
    h.sesion = { authenticated: true, user: { email: "nadie@hiuman.edu.mx", name: "Nadie" } };
    expect((await get()).role).toBe("viewer");
  });

  // Este rol sólo pinta UI: el gate real vive en /api/admin/users. Una tabla
  // caída no puede dejar el shell sin footer, y el default va al lado seguro.
  it("si el lookup falla, responde igual y cae a viewer", async () => {
    await recordLogin("jefa@hiuman.edu.mx", "Jefa");
    const store = newMemoryStore();
    store.getUserRole = async () => { throw new Error('relation "users" does not exist'); };
    __setStore(store);
    h.sesion = { authenticated: true, user: { email: "jefa@hiuman.edu.mx", name: "Jefa" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await get();
    expect(body.authenticated).toBe(true);
    expect(body.role).toBe("viewer");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/integration/session-role.test.ts`
Expected: FAIL — `expected undefined to be 'admin'` (la respuesta todavía no trae `role`).

- [ ] **Step 3: Extraer el helper compartido**

`/api/sync/status` ya tiene exactamente esta lectura tolerante. En vez de duplicarla, crear `src/lib/user-role.ts`:

```ts
// Lectura del rol para consumo DECORATIVO (pintar UI). Vive aparte porque la
// necesitan dos rutas y duplicarla haría que una se arregle y la otra no.
//
// ⚠️ No usar esto para autorizar: se traga el error y devuelve `viewer`. El gate
// de /api/admin/users y el de /api/sync leen getUserRole directo, sin catch, para
// que un fallo de base cierre la puerta en vez de abrirla.
import { getUserRole } from "@/lib/db";
import { roleOrDefault, type Role } from "@/lib/authz";

export async function safeRoleFor(email: string | undefined): Promise<Role> {
  if (!email) return "viewer";
  try {
    return roleOrDefault(await getUserRole(email));
  } catch (e) {
    console.error("[auth] no se pudo leer el rol", e);
    return "viewer";
  }
}
```

- [ ] **Step 4: Usar el helper en las dos rutas**

En `src/app/api/auth/session/route.ts`, reemplazar el cuerpo del `GET`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { safeRoleFor } from "@/lib/user-role";

/**
 * Quién está dentro. NO está en el matcher de proxy.ts a propósito: tiene que
 * poder contestar { authenticated: false } sin sesión en vez de 401, porque la
 * llama el shell y no un consumidor de datos.
 *
 * El `role` se lee de la tabla en cada request y NO de la cookie: la sesión dura
 * 7 días y un rol sellado ahí haría que una degradación tardara eso en surtir
 * efecto. Sólo sirve para dibujar (mostrar u ocultar la sección Usuarios); quien
 * autoriza de verdad es /api/admin/users.
 */
export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.authenticated) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    user: session.user ?? null,
    role: await safeRoleFor(session.user?.email),
  });
}
```

En `src/app/api/sync/status/route.ts`, borrar la función local `roleFor` (líneas 14-26), importar el helper y usarlo:

```ts
import { safeRoleFor } from "@/lib/user-role";
```

```ts
  const role = await safeRoleFor(session.user?.email);
```

El import de `getUserRole` y el de `roleOrDefault`/`Role` de ese archivo quedan sin uso: quitarlos del import (deja `canCancel`, `canTrigger`) o el lint falla.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/integration/session-role.test.ts tests/integration/sync-authz.test.ts`
Expected: PASS. El test «si el lookup del rol falla, el estado igual responde y veda el full» de `sync-authz.test.ts` sigue verde: el helper conserva el `console.error` y el default `viewer`.

- [ ] **Step 6: Gate completo**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS, sin warnings de imports sin uso.

- [ ] **Step 7: Commit**

```bash
git add src/lib/user-role.ts src/app/api/auth/session/route.ts src/app/api/sync/status/route.ts tests/integration/session-role.test.ts
git commit -m "feat(auth): la sesion informa el rol para pintar la UI"
```

---

### Task 5: Menú del footer de la sesión

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx` (generado por la CLI de shadcn)
- Modify: `src/app/components/app-shell.tsx` (footer, estado del peek, imports)
- Modify: `tests/e2e/smoke.spec.ts:14` y `:122-138`
- Modify: `tests/e2e/onboarding.spec.ts:126` y `:147`

**Interfaces:**
- Consumes: `logout()` y `loggingOut`, ya en `AppShell`.
- Produces: el botón disparador con `aria-label="Menú de sesión"` y un `DropdownMenuContent` con un único item, «Cerrar sesión» (`role="menuitem"`). Los items Configuración y Ayuda **no entran acá**: los agrega Task 6 junto con el modal que abren, para que esta tarea no deje botones que no hacen nada.

- [ ] **Step 1: Generar la primitiva**

```bash
npx shadcn@latest add dropdown-menu
```

Confirma que crea `src/components/ui/dropdown-menu.tsx` y no pisa nada más (`git status` debe mostrar sólo ese archivo nuevo). Si la CLI ofrece sobrescribir otros componentes, decir que no.

- [ ] **Step 2: Escribir el test E2E que falla**

Agregar a `tests/e2e/smoke.spec.ts`:

```ts
// La identidad del footer es el disparador del menú de sesión: el logout vive
// adentro y ya no es un icono suelto.
test("el footer de la sidebar abre el menú de sesión", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "password real desconocido");
  await login(page);
  const sidebar = page.getByRole("complementary", { name: "Navegación" });
  await sidebar.getByRole("button", { name: "Menú de sesión" }).click();
  await expect(page.getByRole("menuitem", { name: "Cerrar sesión" })).toBeVisible();
  // Y cierra sesión de verdad: vuelve a la pantalla de ingreso.
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("button", { name: /Continuar con Google/ })).toBeVisible();
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npm run test:e2e -- --workers=2 -g "menú de sesión"`
Expected: FAIL — no existe el botón «Menú de sesión».

⚠️ Cortá `npm run dev` antes: el `next build` del webServer escribe en el mismo `.next/` y los chunks stale lo corrompen (síntoma: `MODULE_UNPARSABLE` en `src/instrumentation.ts`). Si pasa: matar el dev server, `Remove-Item .next -Recurse -Force`.

- [ ] **Step 4: Reemplazar el footer**

En `src/app/components/app-shell.tsx`, sumar a los imports:

```tsx
import { ChevronsUpDown, Settings } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
```

Agregar el estado del menú junto a los demás `useState`:

```tsx
  const [menuOpen, setMenuOpen] = useState(false);
```

Reemplazar el bloque del footer (líneas 341-364, el `<div className="flex items-center gap-2.5 border-t …">` completo) por:

```tsx
        {/* Footer de sesión: identidad + menú. modal={false} por el mismo motivo
            que AppModal: el default de Radix vuelve inert todo lo de afuera, y
            con la barra asomada eso deja el resto del shell muerto mientras el
            menú está abierto. */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <button aria-label="Menú de sesión"
                    className="flex w-full items-center gap-2.5 border-t border-sidebar-border px-4 py-2.5 text-left transition hover:bg-card">
              {/* Iniciales en vez de la foto de Google: la imagen vive en
                  lh3.googleusercontent.com, lo que obliga a declarar
                  images.remotePatterns y dispara una petición externa en cada
                  carga. El nombre cae al correo cuando Google no manda `name`. */}
              <span aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                {initials(user?.name ?? user?.email ?? "")}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-xs text-sidebar-foreground">{user?.name ?? "Sesión activa"}</span>
                {user?.email && <span className="truncate text-[10.5px] text-subtle">{user.email}</span>}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[15.5rem]">
            <DropdownMenuItem onSelect={logout} disabled={loggingOut}>
              {loggingOut ? <Spinner className="h-3.5 w-3.5" /> : <LogOut className="h-4 w-4" />}
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
```

El `Tooltip` del logout desaparece con el bloque viejo. Si `Settings` no se usa todavía, no lo importes en esta tarea: entra en Task 6.

- [ ] **Step 5: Evitar que la barra asomada se cierre con el menú abierto**

Con la sidebar desanclada, el efecto de `peek` cierra la barra cuando el puntero cruza `PEEK_HIT_X`. Con el menú abierto el cursor puede irse a un item y la barra desaparecería debajo del menú. Cambiar la guarda del efecto (línea 170):

```tsx
  useEffect(() => {
    // Con el menú de sesión abierto la barra se queda: si no, el cursor se va a
    // un item, cruza la frontera del peek y la barra desaparece dejando el menú
    // flotando sobre el contenido.
    if (!peek || menuOpen) return;
```

y agregar `menuOpen` a las dependencias del efecto.

- [ ] **Step 6: Reapuntar los tests existentes que dependían del botón suelto**

`tests/e2e/smoke.spec.ts:14` — reemplazar:

```ts
  await expect(sidebar.getByRole("button", { name: "Menú de sesión" })).toBeVisible();
```

`tests/e2e/onboarding.spec.ts:126` y `:147` — antes de cada clic, abrir el menú. Reemplazar cada línea `…getByRole("button", { name: "Cerrar sesión" }).click();` por:

```ts
  await page.getByRole("complementary", { name: "Navegación" })
            .getByRole("button", { name: "Menú de sesión" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
```

`tests/e2e/smoke.spec.ts:126` — ese test prueba el **tooltip** del botón de logout, y un item de menú no lleva tooltip: pierde su sujeto. Reapuntarlo al otro botón de icono de la barra, que sí lo conserva:

```ts
  await sidebar.getByRole("button", { name: "Ocultar menú" }).hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toHaveText("Ocultar menú");
```

(el resto del test —color de fondo y cierre con `mouse.move(…, { steps: 10 })`— queda igual.)

- [ ] **Step 7: Correr los E2E afectados**

Run: `npm run test:e2e -- --workers=2 -g "menú de sesión|tooltip|onboarding"`
Expected: PASS.

⚠️ En máquinas cargadas los 4 workers default dan falsos rojos por timeout. Antes de investigar un rojo, reproducilo con `--workers=2`.

- [ ] **Step 8: Suite E2E completa + gate**

Run: `npm run test:e2e -- --workers=2`
Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS en ambos.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/dropdown-menu.tsx src/app/components/app-shell.tsx tests/e2e/smoke.spec.ts tests/e2e/onboarding.spec.ts
git commit -m "feat(ui): menu de sesion en el footer de la sidebar"
```

---

### Task 6: Modal de configuración con Cuenta y Acerca de

**Files:**
- Create: `src/app/components/settings/settings-modal.tsx`
- Modify: `src/app/components/app-shell.tsx` (items del menú, estado del modal, `role` y `meta` de los fetches que ya hace)
- Test: `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `canManageUsers` (Task 1); el campo `role` de `/api/auth/session` (Task 4).
- Produces:
  - `export type SectionId = "cuenta" | "usuarios" | "acerca"`
  - `export function SettingsModal(props: { section: SectionId; onSection: (s: SectionId) => void; onClose: () => void; user: SessionUser | null; role: Role; meta: CacheMeta | null }): JSX.Element`
  - La sección `usuarios` renderiza un placeholder en esta tarea; Task 7 la reemplaza.

- [ ] **Step 1: Escribir el test E2E que falla**

Crear `tests/e2e/settings.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

async function abrirConfiguracion(page: import("@playwright/test").Page) {
  await page.getByRole("complementary", { name: "Navegación" })
            .getByRole("button", { name: "Menú de sesión" }).click();
  await page.getByRole("menuitem", { name: "Configuración" }).click();
}

test("Configuración abre el panel en Cuenta y muestra el correo", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page);
  await abrirConfiguracion(page);

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Cuenta" })).toBeVisible();
  await expect(panel.getByText("e2e@hiuman.edu.mx")).toBeVisible();

  // Esc lo cierra, como el resto de los modals de la app.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("Ayuda abre el mismo panel directo en Acerca de", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page);
  await page.getByRole("complementary", { name: "Navegación" })
            .getByRole("button", { name: "Menú de sesión" }).click();
  await page.getByRole("menuitem", { name: "Ayuda" }).click();

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await expect(panel.getByRole("heading", { name: "Acerca de" })).toBeVisible();
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm run test:e2e -- --workers=2 settings.spec.ts`
Expected: FAIL — no existe el item «Configuración».

- [ ] **Step 3: Escribir el modal**

Crear `src/app/components/settings/settings-modal.tsx`:

```tsx
"use client";
// Panel de configuración: modal grande centrado con secciones a la izquierda.
//
// NO reúsa AppModal a propósito. Ese es deliberadamente no-modal (modal={false})
// y está anclado a top-10 porque el onboarding guiado necesita clickear su
// popover con el modal abierto. Acá se quiere lo contrario —grande y centrado— y
// no hay tour con el que convivir.
import { Info, User, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canManageUsers, type Role } from "@/lib/authz";
import type { SessionUser } from "@/lib/session";
import type { CacheMeta } from "@/lib/types";

export type SectionId = "cuenta" | "usuarios" | "acerca";

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { id: "cuenta", label: "Cuenta", icon: <User className="h-4 w-4 shrink-0" /> },
  { id: "usuarios", label: "Usuarios", icon: <Users className="h-4 w-4 shrink-0" />, adminOnly: true },
  { id: "acerca", label: "Acerca de", icon: <Info className="h-4 w-4 shrink-0" /> },
];

const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", viewer: "Lectura" };

function fmtFecha(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

export function SettingsModal({ section, onSection, onClose, user, role, meta }: {
  section: SectionId;
  onSection: (s: SectionId) => void;
  onClose: () => void;
  user: SessionUser | null;
  role: Role;
  meta: CacheMeta | null;
}) {
  const visible = SECTIONS.filter((s) => !s.adminOnly || canManageUsers(role));
  // El rol llega por fetch y puede cambiar bajo los pies (una degradación en
  // otra pestaña): si la sección activa deja de existir, cae a la primera en vez
  // de dejar el panel en blanco.
  const active = visible.some((s) => s.id === section) ? section : visible[0].id;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 sm:max-w-3xl"
                     style={{ height: "min(620px, 85vh)" }}>
        <DialogHeader className="border-b border-border px-5 py-3.5">
          <DialogTitle className="font-display text-base font-semibold">Configuración</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-col sm:flex-row">
          {/* Nav: columna en desktop, tira horizontal abajo de sm */}
          <nav aria-label="Secciones"
               className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-[11.5rem] sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r">
            {visible.map((s) => (
              <button key={s.id} onClick={() => onSection(s.id)}
                      aria-current={active === s.id ? "page" : undefined}
                      className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] transition ${
                        active === s.id
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-card hover:text-foreground"
                      }`}>
                {s.icon}
                {s.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {active === "cuenta" && <Cuenta user={user} role={role} />}
            {active === "usuarios" && <p className="text-sm text-muted-foreground">Sección de usuarios.</p>}
            {active === "acerca" && <Acerca meta={meta} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Cuenta({ user, role }: { user: SessionUser | null; role: Role }) {
  return (
    <section className="space-y-5">
      <h2 className="font-display text-[15px] font-semibold text-foreground">Cuenta</h2>
      <div className="flex items-center gap-3">
        <span aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
          {(user?.name ?? user?.email ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{user?.name ?? "Sesión activa"}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <dl className="space-y-2 border-t border-border pt-4 text-[13px]">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Permisos</dt>
          <dd className="font-medium text-foreground">{ROLE_LABEL[role]}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Ingreso</dt>
          <dd className="text-foreground">Google · cuenta institucional</dd>
        </div>
      </dl>
      <div className="rounded-xl border border-dashed border-border p-4">
        <p className="text-[13px] font-medium text-muted-foreground">Preferencias personales</p>
        <p className="mt-1 text-[12.5px] text-subtle">
          Próximamente: idioma, formato de fecha y qué reporte abrir primero.
        </p>
      </div>
    </section>
  );
}

function Acerca({ meta }: { meta: CacheMeta | null }) {
  const ultimo = meta?.lastIncrementalAt ?? meta?.lastFullAt ?? null;
  return (
    <section className="space-y-4">
      <h2 className="font-display text-[15px] font-semibold text-foreground">Acerca de</h2>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">iU Notion Reports</span> sirve reportes y
        exportaciones a partir de una copia de las bases de Notion de iU Corp. Las consultas no
        salen a Notion en vivo: leen esa copia, que se actualiza sola todos los días.
      </p>
      <dl className="space-y-2 border-t border-border pt-4 text-[13px]">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Última actualización</dt>
          <dd className="text-foreground">{fmtFecha(ultimo)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Registros</dt>
          <dd className="text-foreground tabular-nums">{(meta?.count ?? 0).toLocaleString("es-MX")}</dd>
        </div>
      </dl>
      <p className="text-[12.5px] text-subtle">
        ¿Algo no cuadra? Escribile a quien administra la herramienta antes de rehacer un reporte a mano.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Conectar el modal al shell**

En `src/app/components/app-shell.tsx`:

Imports nuevos:

```tsx
import { Settings, HelpCircle } from "lucide-react";
import { SettingsModal, type SectionId } from "@/app/components/settings/settings-modal";
import type { Role } from "@/lib/authz";
import type { CacheMeta } from "@/lib/types";
```

Estado nuevo, junto a los demás:

```tsx
  const [settings, setSettings] = useState<SectionId | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [meta, setMeta] = useState<CacheMeta | null>(null);
```

En el efecto que ya consulta `/api/sync/status` (líneas 125-136), guardar la `meta` completa además del contador — es el mismo fetch, no uno nuevo:

```tsx
        const s = await r.json();
        if (!alive) return;
        if (typeof s?.meta?.count === "number") setCount(s.meta.count);
        if (s?.meta) setMeta(s.meta as CacheMeta);
```

En el efecto que consulta `/api/auth/session` (líneas 141-152), guardar el rol:

```tsx
        const j = (await r.json()) as { user?: SessionUser | null; role?: Role };
        if (!alive) return;
        if (j.user) setUser(j.user);
        if (j.role) setRole(j.role);
```

Agregar los dos items al principio del `DropdownMenuContent`, con un separador entre ellos y el logout que ya está (importar `DropdownMenuSeparator` si no estaba):

```tsx
            <DropdownMenuItem onSelect={() => setSettings("cuenta")}>
              <Settings className="h-4 w-4" />
              Configuración
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSettings("acerca")}>
              <HelpCircle className="h-4 w-4" />
              Ayuda
            </DropdownMenuItem>
            <DropdownMenuSeparator />
```

Y montar el modal junto al `<TourLayer>`, dentro del `<div>` de contenido:

```tsx
        {settings && (
          <SettingsModal section={settings} onSection={setSettings}
                         onClose={() => setSettings(null)}
                         user={user} role={role} meta={meta} />
        )}
```

- [ ] **Step 5: Correr los E2E nuevos**

Run: `npm run test:e2e -- --workers=2 settings.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/components/settings/settings-modal.tsx src/app/components/app-shell.tsx tests/e2e/settings.spec.ts
git commit -m "feat(ui): panel de configuracion con cuenta y acerca de"
```

---

### Task 7: Sección Usuarios

**Files:**
- Create: `src/app/components/settings/users-section.tsx`
- Modify: `src/app/components/settings/settings-modal.tsx` (reemplaza el placeholder y pasa el correo propio)

**Interfaces:**
- Consumes: `GET/PATCH/DELETE /api/admin/users` (Task 3); `type UserRow` de `@/lib/store-shared`.
- Produces: `export function UsersSection({ meEmail }: { meEmail: string }): JSX.Element`.

- [ ] **Step 1: Escribir la sección**

Crear `src/app/components/settings/users-section.tsx`:

```tsx
"use client";
// Tabla de usuarios: quién entró, con qué rol, y las dos acciones que hay.
// Después de cada acción la lista se refetchea entera en vez de mutar el estado
// local: son decenas de filas y la simplicidad vale más que el ahorro.
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/app/components/spinner";
import { normalizeEmail, type Role } from "@/lib/authz";
import type { UserRow } from "@/lib/store-shared";

function fmtAcceso(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

export function UsersSection({ meEmail }: { meEmail: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const yo = normalizeEmail(meEmail);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users");
      if (!r.ok) { setError("No se pudo cargar la lista."); return; }
      setUsers((await r.json()).users as UserRow[]);
      setError(null);
    } catch {
      setError("No se pudo cargar la lista.");
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function cambiarRol(email: string, role: Role) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!r.ok) { setError("No se pudo cambiar el rol."); return; }
      setError(null);
      await load();
    } finally { setBusy(false); }
  }

  async function borrar(email: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/users?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (!r.ok) { setError("No se pudo borrar el usuario."); return; }
      setError(null);
      setConfirming(null);
      await load();
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold text-foreground">Usuarios</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Quienes entraron alguna vez. Un administrador puede reconstruir el snapshot completo;
          lectura alcanza para reportes, exportación y el Asistente.
        </p>
      </div>

      {error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>}

      {users === null ? (
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Spinner className="h-4 w-4 text-sky" />
          <span className="text-[13px]">Cargando…</span>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {users.map((u) => {
            const propio = normalizeEmail(u.email) === yo;
            const enConfirmacion = confirming === u.email;
            return (
              <li key={u.email} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {u.name ?? u.email}
                    {propio && <span className="ml-1.5 text-[11.5px] font-normal text-subtle">(vos)</span>}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">{u.email}</p>
                </div>

                {enConfirmacion ? (
                  // Confirmación en la propia fila y no en un segundo diálogo: un
                  // Dialog de Radix anidado dentro de otro trae problemas de foco
                  // que no valen la pena por una confirmación de una línea.
                  <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                    <p className="text-[12px] text-muted-foreground">
                      Se le quita el rol y sale de la lista. <span className="text-subtle">No pierde el acceso: vuelve como lectura si entra de nuevo.</span>
                    </p>
                    <Button size="sm" variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
                      Cancelar
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => borrar(u.email)} disabled={busy}>
                      Borrar
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="w-[6.5rem] shrink-0 text-right text-[11.5px] text-subtle">
                      {fmtAcceso(u.lastLoginAt)}
                    </span>

                    {/* ⚠️ La fila propia va vedada con aria-disabled y SIN onClick,
                        no con `disabled`: un control deshabilitado no emite
                        eventos de puntero y el tooltip que explica el veto nunca
                        aparecería. Se muestra en vez de ocultarse porque el
                        control existe en todas las demás filas. */}
                    {propio ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="sm" aria-disabled="true"
                                  className="w-[7.5rem] shrink-0 justify-start opacity-60">
                            {u.role === "admin" ? "Administrador" : "Lectura"}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>No podés cambiar tu propio rol</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Select value={u.role} disabled={busy}
                              onValueChange={(v) => cambiarRol(u.email, v as Role)}>
                        <SelectTrigger size="sm" className="w-[7.5rem] shrink-0"
                                       aria-label={`Rol de ${u.name ?? u.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="viewer">Lectura</SelectItem>
                        </SelectContent>
                      </Select>
                    )}

                    {propio ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" aria-disabled="true"
                                  aria-label={`Borrar a ${u.name ?? u.email}`}
                                  className="h-8 w-8 shrink-0 text-muted-foreground opacity-60">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>No podés borrar tu propio usuario</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button variant="ghost" size="icon" disabled={busy}
                              onClick={() => setConfirming(u.email)}
                              aria-label={`Borrar a ${u.name ?? u.email}`}
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-danger">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Reemplazar el placeholder del modal**

En `src/app/components/settings/settings-modal.tsx`, importar la sección y cambiar la línea del placeholder:

```tsx
import { UsersSection } from "@/app/components/settings/users-section";
```

```tsx
            {active === "usuarios" && <UsersSection meEmail={user?.email ?? ""} />}
```

- [ ] **Step 3: Verificar el tamaño del `SelectTrigger`**

`src/components/ui/select.tsx` puede no aceptar la prop `size`. Comprobalo:

Run: `npx tsc --noEmit`

Si `size="sm"` no existe en ese componente, quitá la prop y dejá sólo `className="w-[7.5rem] shrink-0 h-8"`.

- [ ] **Step 4: Gate**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/settings/users-section.tsx src/app/components/settings/settings-modal.tsx
git commit -m "feat(ui): tabla de usuarios con cambio de rol y borrado"
```

---

### Task 8: E2E de la sección Usuarios

**Files:**
- Modify: `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `login(page, { role })` de `tests/e2e/helpers.ts`. El stub emite **una identidad distinta por rol** (`e2e@hiuman.edu.mx` para admin, `e2e-viewer@hiuman.edu.mx` para viewer) porque la suite corre `fullyParallel` sobre un memory-store singleton de proceso.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/e2e/settings.spec.ts`:

```ts
test("un admin ve la sección Usuarios y cambia un rol", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page);
  await abrirConfiguracion(page);

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await panel.getByRole("button", { name: "Usuarios" }).click();
  await expect(panel.getByRole("heading", { name: "Usuarios" })).toBeVisible();

  // La fila propia existe pero está vedada, y el tooltip lo explica: es lo que se
  // rompería si alguien cambiara aria-disabled por disabled.
  const propio = panel.getByRole("button", { name: "Borrar a Usuario E2E", exact: true });
  await expect(propio).toHaveAttribute("aria-disabled", "true");
  await propio.hover();
  await expect(page.getByText("No podés borrar tu propio usuario")).toBeVisible();
});

test("un viewer no tiene la sección Usuarios", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page, { role: "viewer" });
  await abrirConfiguracion(page);

  const panel = page.getByRole("dialog", { name: "Configuración" });
  await expect(panel.getByRole("heading", { name: "Cuenta" })).toBeVisible();
  // No se le veda con tooltip: no existe para él.
  await expect(panel.getByRole("button", { name: "Usuarios" })).toHaveCount(0);
});
```

- [ ] **Step 2: Correr y verificar**

Run: `npm run test:e2e -- --workers=2 settings.spec.ts`
Expected: PASS (4 tests).

Si el test del admin no encuentra «Borrar a Usuario E2E»: el nombre accesible sale de `u.name ?? u.email`, y el stub crea al admin con `name: "Usuario E2E"`. Verificá en `src/app/api/auth/stub-login/route.ts` que ese sea el nombre y ajustá el selector si cambió.

- [ ] **Step 3: Suite E2E completa**

Run: `npm run test:e2e -- --workers=2`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/settings.spec.ts
git commit -m "test(e2e): la seccion usuarios existe solo para admins"
```

---

### Task 9: Documentación

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Endpoints**

En la sección «Endpoints», después de la línea de `/api/auth/session`, agregar:

```markdown
- `GET|PATCH|DELETE /api/admin/users` — administración de usuarios (protegido por el proxy). `GET` lista `UserRow[]`; `PATCH` recibe `{email, role}`; `DELETE` recibe `?email=`. Exige `admin`: **403 `forbidden`** si no. **409 `self`** al operar sobre uno mismo, **400 `bad_role`** con un rol inventado, **400 `bad_request`** sin email. ⚠️ Su gate **no lleva `try/catch`**: acá un error de base tiene que cerrar la puerta.
```

Y en la línea de `/api/auth/session`, agregar que ahora devuelve `role`:

```markdown
- `GET /api/auth/session` — `{authenticated, user?, role?}`; **fuera** del matcher del proxy. El `role` se lee de la tabla en cada request (nunca de la cookie) y es **decorativo**: sólo decide si la UI dibuja la sección Usuarios. Va por `safeRoleFor` de `src/lib/user-role.ts`, que se traga el error y cae a `viewer` — quien autoriza de verdad es `/api/admin/users`.
```

- [ ] **Step 2: Auth**

En la sección «Auth», actualizar el bullet del proxy para incluir `/api/admin/*` en la lista de rutas protegidas, y agregar al bullet de Roles:

```markdown
`canManageUsers(role)` decide la pantalla de administración y `canEditUser(actor, target)` prohíbe operar sobre uno mismo — de ahí sale, sin contar admins ni reglas de «último admin», que **nunca pueda quedar la app sin ningún admin**: quien administra no puede degradarse ni borrarse. `src/lib/user-role.ts` es la lectura **tolerante** del rol (para pintar); los gates leen `getUserRole` directo, sin catch.
```

- [ ] **Step 3: Páginas (UI)**

En la sección «Páginas (UI)», dentro del bullet de `app-shell.tsx`, agregar:

```markdown
El footer de sesión es el disparador de un **`DropdownMenu`** (`aria-label="Menú de sesión"`) con Configuración, Ayuda y Cerrar sesión — el logout dejó de ser un icono suelto, así que los E2E abren el menú antes de cerrar sesión. Va con `modal={false}` por el mismo motivo que `AppModal`, y mientras está abierto el efecto del `peek` no cierra la barra: si no, el cursor cruza `PEEK_HIT_X` camino a un item y la barra desaparece dejando el menú flotando.
```

Y un bullet nuevo:

```markdown
- **`src/app/components/settings/`** — panel de configuración: modal grande centrado con secciones (Cuenta, Usuarios, Acerca de). **No reúsa `AppModal`**: ese es no-modal y está anclado a `top-16` por el onboarding, y acá se quiere lo contrario. La sección **Usuarios sólo existe para admins** (`canManageUsers`) y no se le veda al viewer con tooltip — no se le dibuja. Dentro de la tabla sí hay veto explicado: la **fila propia** lleva el rol y el borrado con `aria-disabled` + tooltip, porque el control existe en todas las demás filas. Borrar confirma **en la propia fila** (un Dialog dentro de otro Dialog trae problemas de foco) y la copy aclara que **borrar no quita el acceso**: la puerta es `ALLOWED_EMAIL_DOMAINS` y `recordLogin` recrea la fila como `viewer`.
```

- [ ] **Step 4: Esquema y operación**

En la tabla de esquema de Postgres, en la fila de `users`, agregar al final de la celda de propósito: `La UI de administración vive en el panel de configuración; `set-role.cjs` sigue siendo la vía para el primer admin de un despliegue nuevo (la pantalla exige ser admin para verse).`

- [ ] **Step 5: Gate final completo**

Run: `npm test && npm run lint && npx tsc --noEmit`
Run: `npm run test:e2e -- --workers=2`
Expected: PASS en ambos. Pegá la salida real, no un resumen.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: panel de configuracion y administracion de usuarios"
```

---

## Verificación manual antes del PR

Con `npm run dev` y la base cloud (tu usuario ya es `admin`):

1. Click en tu nombre abajo a la izquierda → el menú abre hacia arriba.
2. Configuración → el panel abre centrado en Cuenta, con tu correo y «Administrador».
3. Sección Usuarios → aparecen las filas reales de la tabla. Tu fila dice «(vos)» y sus dos controles están vedados con tooltip.
4. Cambiá el rol de otra persona y recargá: el cambio persiste.
5. Ayuda → el panel abre en Acerca de con la fecha del último sync.

⚠️ Esto escribe en la base que ven los colaboradores (local y producción comparten la misma base de Supabase). Cambiá roles sólo de cuentas cuyo rol puedas restaurar, o usá `node scripts/set-role.cjs <email> <rol>` para dejarlas como estaban.
