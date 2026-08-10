# Gestión de usuarios y roles — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Goal:** Que sólo un admin pueda disparar un Full sync, y que exista una lista de quién tiene acceso a la app y cuándo entró por última vez.

**Architecture:** Una tabla `users` en Postgres que se puebla sola en el primer login y es la **única fuente de verdad** de los roles — no se cachea en la cookie de sesión. Las reglas de permiso viven en un módulo puro (`src/lib/authz.ts`) que no importa nada de Next, y las route handlers sólo traducen HTTP. La UI no interpreta roles: recibe booleanos ya calculados en el server dentro del payload de `/api/sync/status`, que la página de reportes ya polea.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Postgres vía `postgres.js` (sin ORM), iron-session, Vitest, Playwright, shadcn/ui sobre Radix.

**Spec:** `docs/superpowers/specs/2026-08-10-gestion-usuarios-roles-design.md`

## Global Constraints

- **Español en todo lo visible y en los comentarios.** Los identificadores de código van en inglés, como el resto del repo.
- **Path alias:** `@/*` → `src/*`.
- **Gate de verificación antes de dar cualquier tarea por terminada:** `npm test && npm run lint && npx tsc --noEmit`. Hay que mostrar la salida real, no un resumen.
- **Nada de mocks globales para Notion/Postgres:** se usa `__setStore(newMemoryStore())` de `@/lib/db` y `__setClient(fake)` de `@/lib/notion`. Si cambia el comportamiento del SQL real, el memory-store se actualiza para seguir siendo fiel (lección D1: un fake infiel ocultó un bug de producción).
- **`ALLOWED_EMAIL_DOMAINS` no se toca.** Sigue siendo la puerta de entrada; los roles son una capa aparte.
- **No se modifica** `supabase/migrations/20260708161911_esquema_inicial.sql` — ya está aplicada en la base cloud. Todo va en un archivo nuevo.
- **Commits pequeños**, mensaje en imperativo, asunto ≤72 caracteres, cuerpo que explique el **por qué**.
- **Dos roles y sólo dos:** `admin` y `viewer`. El default es `viewer`.

---

## Estructura de archivos

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/authz.ts` | Reglas puras de permiso y normalización de email. Sin imports de Next. |
| `supabase/migrations/20260810120000_usuarios_roles.sql` | Tabla `users`. |
| `scripts/set-role.cjs` | Promover/degradar por línea de comandos. |
| `tests/unit/authz.test.ts` | Tabla de verdad de las reglas. |
| `tests/fixtures/userCases.ts` | Casos compartidos de la tabla `users` (mismo patrón que `reportCases.ts`). |
| `tests/integration/users.memory.test.ts` | Corre los casos compartidos contra el memory-store. |
| `tests/integration/callback-registro.test.ts` | El callback de Google da de alta al usuario. |
| `tests/integration/sync-authz.test.ts` | El gate de `/api/sync` y los `perms` de `/api/sync/status`, a nivel route handler. |
| `tests/e2e/roles.spec.ts` | Viewer ve el Full deshabilitado; admin lo ve utilizable. |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `src/lib/store-shared.ts` | Tres métodos nuevos en la interfaz `Store`. |
| `src/lib/db.ts` | Implementación Postgres + wrappers exportados. |
| `src/lib/memory-store.ts` | Implementación en memoria. |
| `src/lib/types.ts` | `perms` en `SyncStatusResponse`. |
| `src/app/api/auth/google/callback/route.ts` | Llama a `recordLogin`. |
| `src/app/api/sync/route.ts` | `identify` + gate por rol; 403. |
| `src/app/api/sync/status/route.ts` | Devuelve `perms`. |
| `src/app/db/tiempos/reports/page.tsx` | Botones Full y Cancelar según `perms`. |
| `src/app/api/auth/stub-login/route.ts` | Acepta `?role=`. |
| `tests/integration/db.pg.test.ts` | `users` en drop/truncate + casos compartidos. |
| `CLAUDE.md` | Documenta tabla, endpoint, roles y puesta en marcha. |

---

## Task 1: Reglas puras de autorización

**Files:**
- Create: `src/lib/authz.ts`
- Test: `tests/unit/authz.test.ts`

**Interfaces:**
- Consumes: `SyncKind` de `@/lib/types` (`"incremental" | "full"`).
- Produces: `type Role = "admin" | "viewer"`; `normalizeEmail(email: string): string`; `roleOrDefault(role: Role | null | undefined): Role`; `canTrigger(role: Role, kind: SyncKind): boolean`; `canCancel(role: Role, runningKind: SyncKind | null): boolean`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/authz.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, roleOrDefault, canTrigger, canCancel } from "@/lib/authz";

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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Ejecutar: `npx vitest run tests/unit/authz.test.ts`
Esperado: FALLA con un error de resolución de módulo — `Failed to resolve import "@/lib/authz"`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/authz.ts`:

```ts
// src/lib/authz.ts
// Reglas de autorización por rol. Puras y sin nada de Next adentro, por el mismo
// motivo que google-oauth.ts: `cookies()` lanza fuera de un request, así que si la
// decisión viviera dentro de la route handler se quedaría sin tests. La handler
// sólo traduce HTTP ↔ estas funciones.
import type { SyncKind } from "@/lib/types";

export type Role = "admin" | "viewer";

/** Los emails se guardan y se comparan en minúsculas: `Pablo@` y `pablo@` son la
 *  misma persona, y dos filas harían que una promoción a admin no surtiera efecto
 *  al volver a entrar con la otra grafía. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Sin fila en `users` no hay rol. La conversión tiene nombre propio en vez de un
 *  `?? "viewer"` repetido en cada punto de uso, para que sea una decisión con test. */
export function roleOrDefault(role: Role | null | undefined): Role {
  return role ?? "viewer";
}

/** El incremental es libre; el full reconstruye el snapshot de ~21k filas y
 *  encadena invocaciones por minutos, así que es de admin. */
export function canTrigger(role: Role, kind: SyncKind): boolean {
  return kind === "incremental" || role === "admin";
}

/** Cancelar aborta lo que esté corriendo, sea de quien sea, así que el permiso lo
 *  define el sync en curso y no quién lo lanzó. `null` = nada corriendo: el DELETE
 *  es un no-op y no hay motivo para prohibirlo. */
export function canCancel(role: Role, runningKind: SyncKind | null): boolean {
  return runningKind !== "full" || role === "admin";
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Ejecutar: `npx vitest run tests/unit/authz.test.ts`
Esperado: PASA — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/authz.ts tests/unit/authz.test.ts
git commit -m "feat(authz): reglas de permiso por rol como funciones puras

El gate tiene que poder testearse fuera de un request: cookies() lanza si se
lo llama afuera, así que la decisión no puede vivir dentro de la handler."
```

---

## Task 2: Tabla `users` y su acceso desde el `Store`

**Files:**
- Create: `supabase/migrations/20260810120000_usuarios_roles.sql`
- Create: `tests/fixtures/userCases.ts`
- Create: `tests/integration/users.memory.test.ts`
- Modify: `src/lib/store-shared.ts:102-126` (interfaz `Store`)
- Modify: `src/lib/memory-store.ts:236-247` (junto a `rateLimitLogin`)
- Modify: `src/lib/db.ts:287-301` (dentro de `pgStore`) y `src/lib/db.ts:369` (wrappers)
- Modify: `tests/integration/db.pg.test.ts:74,88`

**Interfaces:**
- Consumes: `normalizeEmail`, `Role` de `@/lib/authz` (Task 1).
- Produces: en `@/lib/db` — `recordLogin(email: string, name: string): Promise<void>`, `getUserRole(email: string): Promise<Role | null>`, `setUserRole(email: string, role: Role): Promise<void>`. En `tests/fixtures/userCases.ts` — `runUserAssertions(db: typeof import("@/lib/db")): Promise<void>`.

- [ ] **Step 1: Escribir los casos compartidos (el test que falla)**

Mismo patrón que `tests/fixtures/reportCases.ts`: un solo cuerpo de aserciones que corren tanto el memory-store como Postgres real. Si ambos pasan, el stub es fiel.

Crear `tests/fixtures/userCases.ts`:

```ts
// Casos compartidos de la tabla `users`: los corre users.memory.test.ts contra el
// memory-store y db.pg.test.ts contra Postgres real. Si ambos pasan, el stub es
// fiel al SQL (misma lección D1 que reportCases.ts).
import { expect } from "vitest";

type Db = typeof import("@/lib/db");

export async function runUserAssertions(db: Db) {
  // Primer login: la fila nace con el rol menos privilegiado.
  await db.recordLogin("Pablo@Hiuman.edu.mx", "Pablo");
  // Y se guardó normalizada: la consulta en minúsculas encuentra esa misma fila.
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("viewer");

  // Promoción. Un login posterior refresca la visita pero NO pisa el rol: si el
  // upsert tocara `role`, cada vez que un admin entrara volvería a ser viewer.
  await db.setUserRole("pablo@hiuman.edu.mx", "admin");
  await db.recordLogin("PABLO@hiuman.edu.mx", "Pablo Sánchez");
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("admin");

  // Degradación: el script tiene que poder ir en las dos direcciones.
  await db.setUserRole("pablo@hiuman.edu.mx", "viewer");
  expect(await db.getUserRole("pablo@hiuman.edu.mx")).toBe("viewer");

  // Quien nunca entró no tiene fila. Devuelve null y lo resuelve roleOrDefault.
  expect(await db.getUserRole("nadie@hiuman.edu.mx")).toBeNull();

  // setUserRole sobre alguien que todavía no entró crea la fila: permite dejar
  // listo a un admin antes de su primer login.
  await db.setUserRole("Futuro@hiuman.edu.mx", "admin");
  expect(await db.getUserRole("futuro@hiuman.edu.mx")).toBe("admin");
}
```

Crear `tests/integration/users.memory.test.ts`:

```ts
// Tabla users contra memory-store: MISMOS casos que db.pg.test.ts corre contra
// Postgres real.
import { describe, it, beforeEach } from "vitest";
import { __setStore } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";
import { runUserAssertions } from "../fixtures/userCases";
import * as db from "@/lib/db";

describe("users sobre memory-store", () => {
  beforeEach(() => { __setStore(newMemoryStore()); });

  it("pasa los casos compartidos de usuarios", async () => {
    await runUserAssertions(db);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Ejecutar: `npx vitest run tests/integration/users.memory.test.ts`
Esperado: FALLA — TypeScript/runtime se queja de que `db.recordLogin` no existe (`db.recordLogin is not a function`).

- [ ] **Step 3: Crear la migración**

Crear `supabase/migrations/20260810120000_usuarios_roles.sql`:

```sql
-- Usuarios y roles (spec 2026-08-10). La tabla se puebla sola en el primer login
-- exitoso, después del chequeo de dominio: no es una lista de invitados, es el
-- registro de quién entró.
--
-- El rol NO reemplaza a ALLOWED_EMAIL_DOMAINS, que sigue siendo la puerta de
-- entrada. Esta capa sólo distingue qué puede hacer alguien que YA entró.

create table if not exists users (
  email         text primary key,           -- siempre en minúsculas (normalizeEmail)
  role          text not null default 'viewer'
                check (role in ('admin','viewer')),  -- un typo en el script falla acá,
                                                     -- en vez de crear un rol fantasma
  name          text,                       -- del ID token de Google; para leer la auditoría
  created_at    timestamptz not null default now(),
  last_login_at timestamptz                 -- se pisa en cada login: no hay historial
);
```

- [ ] **Step 4: Agregar los tres métodos a la interfaz `Store`**

En `src/lib/store-shared.ts`, agregar el import arriba del archivo:

```ts
import type { Role } from "@/lib/authz";
```

Y dentro de `interface Store`, justo después de la línea de `rateLimitLogin`:

```ts
  /** Alta o refresco del usuario en el login. La fila nueva nace `viewer`; una
   *  existente conserva su rol (el upsert deja `role` fuera del do-update). */
  recordLogin(email: string, name: string): Promise<void>;
  /** `null` = sin fila. Quien llama lo resuelve con `roleOrDefault`. */
  getUserRole(email: string): Promise<Role | null>;
  /** Crea la fila si no existe: permite dejar listo a un admin antes de su primer login. */
  setUserRole(email: string, role: Role): Promise<void>;
```

- [ ] **Step 5: Implementar en el memory-store**

En `src/lib/memory-store.ts`, agregar al import de `@/lib/store-shared`… no: `Role` y `normalizeEmail` vienen de authz. Agregar un import nuevo arriba:

```ts
import { normalizeEmail, type Role } from "@/lib/authz";
```

Y dentro de la clase `MemoryStore`, después de `rateLimitLogin` (línea ~247):

```ts
  // Espejo de la tabla `users`. Guarda los mismos campos que el SQL aunque hoy
  // sólo se lea `role`: si el stub olvidara last_login_at, un test de la
  // auditoría pasaría en memoria y fallaría contra Postgres.
  private users = new Map<string, { role: Role; name: string; createdAt: string; lastLoginAt: string | null }>();

  async recordLogin(email: string, name: string): Promise<void> {
    const key = normalizeEmail(email);
    const now = new Date().toISOString();
    const cur = this.users.get(key);
    if (cur) {
      // `role` intacto a propósito: un login no puede degradar a un admin.
      cur.name = name;
      cur.lastLoginAt = now;
      return;
    }
    this.users.set(key, { role: "viewer", name, createdAt: now, lastLoginAt: now });
  }

  async getUserRole(email: string): Promise<Role | null> {
    return this.users.get(normalizeEmail(email))?.role ?? null;
  }

  async setUserRole(email: string, role: Role): Promise<void> {
    const key = normalizeEmail(email);
    const cur = this.users.get(key);
    if (cur) { cur.role = role; return; }
    this.users.set(key, { role, name: "", createdAt: new Date().toISOString(), lastLoginAt: null });
  }
```

- [ ] **Step 6: Implementar en Postgres y exportar los wrappers**

En `src/lib/db.ts`, agregar al bloque de imports:

```ts
import { normalizeEmail, type Role } from "@/lib/authz";
```

Dentro de `pgStore`, después de `rateLimitLogin` (antes del `};` que cierra el objeto, línea ~300):

```ts
    // `role` queda FUERA del do-update a propósito: si el login lo escribiera,
    // cada vez que un admin entrara volvería al default y la promoción duraría
    // hasta su próxima visita.
    async recordLogin(email, name) {
      await sql`
        insert into users (email, name, last_login_at)
        values (${normalizeEmail(email)}, ${name}, now())
        on conflict (email) do update set last_login_at = now(), name = excluded.name`;
    },
    async getUserRole(email) {
      const rs = await sql`select role from users where email = ${normalizeEmail(email)}`;
      return rs.length ? (rs[0].role as Role) : null;
    },
    async setUserRole(email, role) {
      await sql`
        insert into users (email, role) values (${normalizeEmail(email)}, ${role})
        on conflict (email) do update set role = excluded.role`;
    },
```

Y al final del archivo, después de la línea de `rateLimitLogin` (línea 369):

```ts
export const recordLogin: Store["recordLogin"] = (e, n) => s().recordLogin(e, n);
export const getUserRole: Store["getUserRole"] = (e) => s().getUserRole(e);
export const setUserRole: Store["setUserRole"] = (e, r) => s().setUserRole(e, r);
```

- [ ] **Step 7: Correr el test de memoria y verificar que pasa**

Ejecutar: `npx vitest run tests/integration/users.memory.test.ts`
Esperado: PASA — 1 test.

- [ ] **Step 8: Sumar `users` al test contra Postgres real**

En `tests/integration/db.pg.test.ts`:

Línea 18, junto al import de `reportCases`:
```ts
import { runUserAssertions } from "../fixtures/userCases";
```

Línea 74, agregar `users` al drop (si no, el replay de migraciones choca con la tabla vieja):
```ts
    await sql.unsafe("drop table if exists pages, pages_new, sync_state, login_attempts, users cascade");
```

Línea 88, agregar `users` al truncate (si no, las filas de un test ensucian el siguiente):
```ts
    await sql`truncate pages, pages_new, sync_state, login_attempts, users`;
```

Y un test nuevo al final del `describe`, junto al de `rateLimitLogin`:

```ts
  it("users: los casos compartidos pasan contra el SQL real, sin duplicar filas", async () => {
    await runUserAssertions(db);
    // Dos personas distintas, no cuatro: la prueba escribió el mismo correo con
    // tres grafías y el upsert tiene que haberlas colapsado en una fila.
    const [{ n }] = await sql`select count(*)::int as n from users`;
    expect(n).toBe(2);
    // last_login_at se llenó en el login y created_at nació con la fila.
    const [u] = await sql`select * from users where email = 'pablo@hiuman.edu.mx'`;
    expect(u.name).toBe("Pablo Sánchez");        // el segundo login refrescó el nombre
    expect(u.last_login_at).not.toBeNull();
    expect(u.created_at).not.toBeNull();
    // Quien nunca entró tiene fila (la creó setUserRole) pero sin visita.
    const [f] = await sql`select * from users where email = 'futuro@hiuman.edu.mx'`;
    expect(f.last_login_at).toBeNull();
  });

  it("users: el check rechaza un rol inventado", async () => {
    await expect(
      sql`insert into users (email, role) values ('x@y.mx', 'superadmin')`,
    ).rejects.toThrow();
  });
```

- [ ] **Step 9: Correr la suite completa**

Ejecutar: `npm test`
Esperado: PASA todo. `db.pg.test.ts` se salta por falta de `TEST_DATABASE_URL` — es lo normal y lo dice la salida (`skipped`).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260810120000_usuarios_roles.sql src/lib/store-shared.ts src/lib/db.ts src/lib/memory-store.ts tests/fixtures/userCases.ts tests/integration/users.memory.test.ts tests/integration/db.pg.test.ts
git commit -m "feat(db): tabla users con rol y última visita

La tabla es la única fuente de verdad del rol: cachearlo en la cookie lo
dejaría hasta 7 días viejo, que es justo lo que el gate tiene que evitar."
```

---

## Task 3: El callback registra el login

**Files:**
- Modify: `src/app/api/auth/google/callback/route.ts:55-60`

**Interfaces:**
- Consumes: `recordLogin` de `@/lib/db` (Task 2).
- Produces: nada nuevo. Efecto: toda persona que completa el login tiene fila en `users`.

- [ ] **Step 1: Escribir el test que falla**

Se ejerce la **handler HTTP de verdad**, no sólo `resolveCallback`: lo que esta
tarea puede olvidar es conectar la llamada, y un test del contrato del `Store` ya
lo cubre Task 2. `cookies()` e iron-session se mockean igual que en Task 4.

Crear `tests/integration/callback-registro.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Ejecutar: `npx vitest run tests/integration/callback-registro.test.ts`
Esperado: FALLA el primer test con `expected null to be "viewer"` — el callback todavía no da de alta a nadie.

- [ ] **Step 3: Llamar a `recordLogin` en el callback**

En `src/app/api/auth/google/callback/route.ts`, agregar al import de `@/lib/db` (línea 6):

```ts
import { rateLimitLogin, recordLogin } from "@/lib/db";
```

Y entre la línea 55 (`if (!r.ok) return fail(r.failure);`) y la creación de la sesión:

```ts
  // Alta o refresco en `users`. Va ANTES de sellar la sesión: si la base no
  // responde, es preferible no emitir una cookie de 7 días para alguien que no
  // quedó registrado. No agrega un modo de falla nuevo — rateLimitLogin, unas
  // líneas arriba, ya depende de la misma base.
  await recordLogin(r.identity.email, r.identity.name);

  const session = await getIronSession<SessionData>(jar, sessionOptions);
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Ejecutar: `npx vitest run tests/integration/callback-registro.test.ts tests/integration/auth-google.test.ts`
Esperado: PASAN los dos nuevos y siguen verdes los de `auth-google.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/google/callback/route.ts tests/integration/callback-registro.test.ts
git commit -m "feat(auth): registrar al usuario en el primer login

La tabla se puebla sola después del chequeo de dominio, así que la lista de
accesos no hay que mantenerla a mano ni queda desincronizada."
```

---

## Task 4: Gate por rol en `/api/sync`

**Files:**
- Modify: `src/app/api/sync/route.ts:12-44` (todo el archivo)
- Test: `tests/integration/sync-authz.test.ts` (crear)

**Interfaces:**
- Consumes: `canTrigger`, `canCancel`, `roleOrDefault`, `Role` de `@/lib/authz` (Task 1); `getUserRole`, `getStatus`, `requestCancel` de `@/lib/db` (Task 2).
- Produces: `POST /api/sync` y `DELETE /api/sync` responden **403 `{ error: "forbidden" }`** cuando el rol no alcanza, y **401 `{ error: "unauthorized" }`** cuando no hay sesión ni bearer.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/integration/sync-authz.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Ejecutar: `npx vitest run tests/integration/sync-authz.test.ts`
Esperado: FALLA. Los casos de viewer + full devuelven **200 en vez de 403** — hoy cualquier sesión autenticada puede con todo. Ése es exactamente el agujero que cierra esta tarea.

- [ ] **Step 3: Reescribir la autorización de la route**

Reemplazar `src/app/api/sync/route.ts` completo:

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { runSync } from "@/lib/sync";
import { getStatus, getUserRole, requestCancel } from "@/lib/db";
import { canCancel, canTrigger, roleOrDefault, type Role } from "@/lib/authz";
import type { SyncKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min (Vercel pro)

/** Quién llama. Antes esto era un booleano; ahora la identidad importa, porque el
 *  permiso depende del rol y no sólo de tener sesión. */
type Caller = { via: "cron" } | { via: "session"; email: string | null };

async function identify(req: NextRequest): Promise<Caller | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && bearer === process.env.CRON_SECRET) return { via: "cron" };
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.authenticated) return null;
  return { via: "session", email: session.user?.email ?? null };
}

/** El cron conserva permisos plenos: es el canal del incremental diario declarado
 *  en vercel.json y no tiene una persona detrás a quien asignarle un rol. Una
 *  sesión sin email (cookie previa a ADR-0008) cae a viewer. */
async function roleOf(caller: Caller): Promise<Role> {
  if (caller.via === "cron") return "admin";
  if (!caller.email) return "viewer";
  return roleOrDefault(await getUserRole(caller.email));
}

export async function POST(req: NextRequest) {
  const caller = await identify(req);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // El kind se valida antes del rol: un kind inventado es 400 para cualquiera, y
  // así no se paga una consulta a la base para rechazarlo.
  const kind = (req.nextUrl.searchParams.get("kind") ?? "incremental") as SyncKind;
  if (kind !== "incremental" && kind !== "full") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  // 403 y no 401: la sesión es válida, lo que falta es el rol. Son dos problemas
  // distintos y el cliente los trata distinto.
  if (!canTrigger(await roleOf(caller), kind)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Await inline: en Vercel Hobby las funciones se matan al responder, así que el
  // patrón "void runSync()" no es confiable. El cliente espera el resultado de
  // este segmento y, si es full y `done:false`, vuelve a llamar.
  const result = await runSync(kind);
  if (!result.ok) {
    const status = result.reason === "locked" ? 409 : 500;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const caller = await identify(req);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Cancelar aborta lo que esté corriendo, así que el permiso lo define el sync en
  // curso: un viewer frena su incremental, pero no el full de un admin.
  const status = await getStatus();
  const runningKind = status.state === "running" ? status.kind : null;
  if (!canCancel(await roleOf(caller), runningKind)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await requestCancel();
  return NextResponse.json({ cancelling: true });
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Ejecutar: `npx vitest run tests/integration/sync-authz.test.ts`
Esperado: PASA — 11 tests.

- [ ] **Step 5: Correr la suite completa (los mocks del archivo nuevo no deben filtrarse)**

Ejecutar: `npm test`
Esperado: PASA todo, incluido `tests/integration/sync.test.ts`, que usa el `runSync` de verdad.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/sync/route.ts tests/integration/sync-authz.test.ts
git commit -m "feat(sync): el full exige rol admin

Cualquiera del dominio podía reconstruir el snapshot de 21k filas. El
incremental sigue libre: es corto y no deja la base a medio construir."
```

---

## Task 5: `perms` en `/api/sync/status`

**Files:**
- Modify: `src/app/api/sync/status/route.ts` (todo el archivo)
- Modify: `src/lib/types.ts:33-37` (`SyncStatusResponse`)
- Test: `tests/integration/sync-authz.test.ts` (agregar un describe)

**Interfaces:**
- Consumes: `canTrigger`, `canCancel`, `roleOrDefault` de `@/lib/authz`; `getUserRole` de `@/lib/db`.
- Produces: `GET /api/sync/status` devuelve `perms: { full: boolean; cancel: boolean }` junto a `status`, `meta` y `next`.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `tests/integration/sync-authz.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Ejecutar: `npx vitest run tests/integration/sync-authz.test.ts -t perms`
Esperado: FALLA con `expected undefined to equal { full: false, cancel: true }` — el endpoint todavía no devuelve `perms`.

- [ ] **Step 3: Implementar**

Reemplazar `src/app/api/sync/status/route.ts` completo:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { getStatus, getMeta, getUserRole } from "@/lib/db";
import { canCancel, canTrigger, roleOrDefault } from "@/lib/authz";
import { nextRun, cronSchedule } from "@/lib/cron";

export const dynamic = "force-dynamic";

const CRON_INCREMENTAL = cronSchedule("incremental");
const CRON_FULL = cronSchedule("full");

export async function GET() {
  const now = new Date();
  const [status, meta] = await Promise.all([getStatus(), getMeta()]);

  // El permiso viaja con el estado y no por /api/auth/session, por una razón
  // estructural: quien consulta la sesión es AppShell, que es HIJO de la página,
  // así que un rol traído por el shell no llega al modal de sync. La página ya
  // polea este endpoint (2s corriendo, 30s en reposo), y el rol es un lookup por
  // clave primaria sobre una tabla de decenas de filas.
  // Esta ruta está en el matcher de proxy.ts, así que acá siempre hay sesión.
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const role = session.user?.email
    ? roleOrDefault(await getUserRole(session.user.email))
    : "viewer";
  const runningKind = status.state === "running" ? status.kind : null;

  return NextResponse.json({
    status, meta,
    // null = ese kind no está croneado (se dispara sólo a mano desde la UI).
    next: {
      incremental: CRON_INCREMENTAL ? nextRun(CRON_INCREMENTAL, now).toISOString() : null,
      full: CRON_FULL ? nextRun(CRON_FULL, now).toISOString() : null,
    },
    // La UI no interpreta roles: obedece estos booleanos.
    perms: {
      full: canTrigger(role, "full"),
      cancel: canCancel(role, runningKind),
    },
  });
}
```

En `src/lib/types.ts`, reemplazar `SyncStatusResponse`:

```ts
export interface SyncStatusResponse {
  status: SyncStatus;
  meta: CacheMeta;
  next: { incremental: string; full: string };
  /** Permisos ya resueltos en el server: la UI no ve roles, sólo booleanos. */
  perms: { full: boolean; cancel: boolean };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Ejecutar: `npx vitest run tests/integration/sync-authz.test.ts`
Esperado: PASA — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sync/status/route.ts src/lib/types.ts tests/integration/sync-authz.test.ts
git commit -m "feat(sync): el status resuelve los permisos del que pregunta

AppShell es hijo de la página, así que un rol pedido desde el shell no llega
al modal de sync. Viaja con el estado, que la página ya polea."
```

---

## Task 6: Botones vedados en el modal de sync

**Files:**
- Modify: `src/app/db/tiempos/reports/page.tsx:92-97` (tipo local), `:741-745` (Cancelar), `:763-773` (Full)

**Interfaces:**
- Consumes: `perms` de `GET /api/sync/status` (Task 5).
- Produces: el botón «Full» y el de cancelar quedan inertes con tooltip cuando el permiso falta. Siguen expuestos con `role="button"` y su nombre accesible intacto, así que los E2E existentes que los buscan por nombre siguen funcionando.

- [ ] **Step 1: Extender el tipo local del payload**

En `src/app/db/tiempos/reports/page.tsx`, en el tipo `SyncStatus` (línea 92), agregar la propiedad:

```ts
type SyncStatus = {
  status: { state: "idle"|"running"|"error"; kind: "incremental"|"full"|null; done: number; total: number; error: string | null; skipped: number; lastResult?: LastResult | null; };
  meta: { lastFullAt: string | null; lastIncrementalAt: string | null; count: number; };
  // null = ese kind no está croneado en vercel.json (sólo disparo manual).
  next: { incremental: string | null; full: string | null; };
  // Resueltos en el server contra la tabla `users`. La UI no ve roles.
  perms: { full: boolean; cancel: boolean };
};
```

- [ ] **Step 2: Agregar el envoltorio de «sin permiso»**

En el mismo archivo, junto a los otros helpers de presentación (después de `fmtCountdown`, línea ~115):

```tsx
/**
 * Botón vedado por rol.
 *
 * ⚠️ El atributo `disabled` NO sirve acá: un botón deshabilitado no emite eventos
 * de puntero, así que el tooltip de Radix nunca se abriría y el control quedaría
 * gris y mudo — justo lo que hay que evitar, porque el tooltip es la única
 * explicación de por qué no se puede. Con `aria-disabled` el botón sigue
 * anunciándose como deshabilitado, conserva el foco y se llega por teclado.
 */
function SinPermiso({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>Requiere permisos de administrador</TooltipContent>
    </Tooltip>
  );
}
```

Y sumar los imports. El de `ReactNode` va en la línea 9, que hoy sólo trae hooks
(`import { useCallback, useEffect, useMemo, useState } from "react";`) — la página
no importa el namespace `React`, así que `React.ReactNode` no compilaría:

```tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

- [ ] **Step 3: Aplicarlo al botón Full**

Reemplazar el bloque de botones (líneas 763-773) por:

```tsx
            <div className="flex flex-wrap items-center gap-2.5">
              <Button onClick={() => trigger("incremental")} disabled={triggering !== null}>
                {triggering === "incremental" ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-4 w-4" />}
                {triggering === "incremental" ? "Iniciando…" : "Refrescar incremental"}
              </Button>
              {syncStatus?.perms.full === false ? (
                <SinPermiso>
                  <Button variant="outline" aria-disabled className="border-border opacity-50">
                    Full
                  </Button>
                </SinPermiso>
              ) : (
                <Button variant="outline" className="border-border-strong" onClick={() => trigger("full")} disabled={triggering !== null}>
                  {triggering === "full" && <Spinner className="h-3.5 w-3.5" />}
                  {triggering === "full" ? "Iniciando…" : "Full"}
                </Button>
              )}
              <span className="ml-auto text-[11.5px] text-subtle">El full puede tardar varios minutos</span>
            </div>
```

> `perms.full === false` y no `!perms?.full`: mientras el primer fetch está en
> vuelo `syncStatus` es `undefined`, y con la negación simple el botón parpadearía
> deshabilitado para todo el mundo en cada carga.
>
> La variante vedada **no lleva `onClick`**: `aria-disabled` es una promesa a la
> tecnología asistiva, no un bloqueo — sin quitar el handler el botón seguiría
> disparando el full al hacer clic.

- [ ] **Step 4: Aplicarlo al botón de cancelar**

Reemplazar el bloque de cancelar (líneas 741-745) por:

```tsx
            {syncStatus?.perms.cancel === false ? (
              <SinPermiso>
                <Button variant="outline" aria-disabled className="border-danger text-danger opacity-50">
                  Cancelar y guardar lo cargado
                </Button>
              </SinPermiso>
            ) : (
              <Button variant="outline" onClick={cancelSync} disabled={cancelling}
                      className="border-danger text-danger hover:bg-danger hover:text-white">
                {cancelling && <Spinner className="h-3.5 w-3.5" />}
                {cancelling ? "Cancelando…" : "Cancelar y guardar lo cargado"}
              </Button>
            )}
```

- [ ] **Step 5: Verificar tipos y lint**

Ejecutar: `npx tsc --noEmit && npm run lint`
Esperado: sin errores. Si `tsc` se queja de que `perms` falta en algún objeto literal de prueba, agregarlo ahí — es la señal de que el tipo nuevo está haciendo su trabajo.

- [ ] **Step 6: Commit**

```bash
git add src/app/db/tiempos/reports/page.tsx
git commit -m "feat(ui): el full y el cancelar se vedan sin rol admin

Van con aria-disabled y no con disabled: un botón deshabilitado no emite
eventos de puntero y el tooltip que explica el veto nunca aparecería."
```

---

## Task 7: Script de operación `set-role.cjs`

**Files:**
- Create: `scripts/set-role.cjs`

**Interfaces:**
- Consumes: `DATABASE_URL` de `.env.local`; la tabla `users` (Task 2).
- Produces: `node scripts/set-role.cjs <email> <admin|viewer>`.

- [ ] **Step 1: Escribir el script**

Mismo molde que `scripts/reset-sync-state.cjs`: lee `.env.local` a mano y habla SQL directo, sin pasar por la app.

Crear `scripts/set-role.cjs`:

```js
// Promueve o degrada a un usuario. La tabla `users` es la única fuente de verdad
// de los roles, así que esto no requiere redeploy ni tocar variables de entorno.
//
// Uso: node scripts/set-role.cjs <email> <admin|viewer>   (lee DATABASE_URL de .env.local)
//
// Crea la fila si la persona todavía no entró nunca, así se puede dejar listo a un
// admin antes de su primer login.
const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
for (const line of env) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const [, , emailRaw, role] = process.argv;
if (!emailRaw || (role !== "admin" && role !== "viewer")) {
  console.error("Uso: node scripts/set-role.cjs <email> <admin|viewer>");
  process.exit(1);
}
// Misma normalización que normalizeEmail en src/lib/authz.ts: este script no pasa
// por el Store, así que si no la repitiera crearía una segunda fila para la misma
// persona y la promoción no tendría efecto.
const email = emailRaw.trim().toLowerCase();

const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL);

(async () => {
  const [row] = await sql`
    insert into users (email, role) values (${email}, ${role})
    on conflict (email) do update set role = excluded.role
    returning email, role, last_login_at`;
  const visita = row.last_login_at ? row.last_login_at.toISOString() : "nunca entró";
  console.log(`${row.email} → ${row.role}  (último login: ${visita})`);
  await sql.end();
})().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verificar el manejo de argumentos sin tocar la base**

Ejecutar: `node scripts/set-role.cjs`
Esperado: imprime `Uso: node scripts/set-role.cjs <email> <admin|viewer>` y sale con código 1, **sin** abrir conexión (el `require("postgres")` está después de la validación).

Ejecutar: `node scripts/set-role.cjs alguien@hiuman.edu.mx superadmin`
Esperado: el mismo mensaje de uso y código 1 — un rol inventado se rechaza antes de llegar al `check` de Postgres.

- [ ] **Step 3: Commit**

```bash
git add scripts/set-role.cjs
git commit -m "feat(scripts): promover y degradar usuarios por línea de comandos

Con la tabla como fuente de verdad, cambiar un admin no exige redeploy; el
script normaliza el email por su cuenta porque no pasa por el Store."
```

---

## Task 8: E2E del viewer

**Files:**
- Modify: `src/app/api/auth/stub-login/route.ts`
- Create: `tests/e2e/roles.spec.ts`
- Modify: `tests/e2e/helpers.ts:14-35` (`login` acepta el rol)

**Interfaces:**
- Consumes: `setUserRole` de `@/lib/db` (Task 2); los botones de Task 6.
- Produces: `GET /api/auth/stub-login?role=viewer`; `login(page, { role: "viewer" })`.

- [ ] **Step 1: Parametrizar el stub-login por rol**

Reemplazar `src/app/api/auth/stub-login/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { setUserRole } from "@/lib/db";

/**
 * Entrada de los E2E: Playwright no puede hablar con Google real. Mismo modelo
 * de confianza que tenía la concesión de verifyPassword con E2E_STUBS, y misma
 * mitigación: sin la bandera esta ruta NO EXISTE (404), y E2E_STUBS nunca se
 * define en Vercel.
 *
 * El correo sigue fijo: lo que el comentario original protegía es la inyección de
 * IDENTIDAD, y eso no cambia. `?role` sí se acepta, porque probar el veto del full
 * exige poder entrar como viewer, y la ruta ya emite una sesión sin credenciales
 * — el parámetro no amplía el modelo de confianza. Default admin, así los E2E
 * previos a los roles siguen pasando sin tocarlos.
 */
const STUB_USER = { email: "e2e@hiuman.edu.mx", name: "Usuario E2E" };

export async function GET(req: NextRequest) {
  if (process.env.E2E_STUBS !== "1") {
    return new NextResponse(null, { status: 404 });
  }
  const role = req.nextUrl.searchParams.get("role") ?? "admin";
  if (role !== "admin" && role !== "viewer") {
    // 400 y no un default silencioso: un typo en un test tiene que doler acá y no
    // convertirse en un E2E que prueba el rol equivocado y pasa igual.
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }
  // Se escribe ANTES de sellar la sesión: el parámetro es la autoridad, así que no
  // compite con lo que haya quedado de una corrida anterior en el store singleton.
  await setUserRole(STUB_USER.email, role);

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

- [ ] **Step 2: Que el helper de login acepte el rol**

En `tests/e2e/helpers.ts`, cambiar la firma y la navegación de `login`:

```ts
export async function login(
  page: Page,
  opts: { welcome?: "skip" | "expect"; role?: "admin" | "viewer" } = {},
): Promise<void> {
```

y la línea 20:

```ts
  await page.goto(`/api/auth/stub-login?role=${opts.role ?? "admin"}`);
```

Agregar a la documentación del helper, después del párrafo de `welcome`:

```
 * role: "admin" (default) para que los tests que no van sobre permisos vean la
 * app completa. "viewer" entra sin poder disparar el full.
```

- [ ] **Step 3: Escribir el E2E**

Crear `tests/e2e/roles.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// El full reconstruye el snapshot entero, así que es de admin. El botón se ve
// igual (que exista es descubrible: dice que la función está y hay que pedir
// acceso), pero inerte y con un tooltip que explica por qué.
test("un viewer ve el botón Full deshabilitado y con explicación", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page, { role: "viewer" });
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await page.getByRole("button", { name: "Sincronizar" }).click();

  // El incremental sigue libre para cualquiera.
  await expect(page.getByRole("button", { name: "Refrescar incremental" })).toBeEnabled();

  const full = page.getByRole("button", { name: "Full", exact: true });
  await expect(full).toBeVisible();
  await expect(full).toHaveAttribute("aria-disabled", "true");

  // El tooltip es la única explicación del veto: si no abriera, el botón quedaría
  // gris y mudo. Es lo que se rompería si alguien cambia aria-disabled por disabled.
  await full.hover();
  await expect(page.getByText("Requiere permisos de administrador")).toBeVisible();
});

test("un admin puede usar el botón Full", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "el stub-login no existe contra el server real");
  await login(page, { role: "admin" });
  await page.locator("main").getByRole("link", { name: "BD Tiempos" }).click();
  await page.getByRole("button", { name: "Sincronizar" }).click();

  const full = page.getByRole("button", { name: "Full", exact: true });
  await expect(full).toBeEnabled();
  await expect(full).not.toHaveAttribute("aria-disabled", "true");
});
```

- [ ] **Step 4: Correr el E2E**

⚠️ Cortar `npm run dev` antes: el `next build` del webServer escribe en el mismo `.next/` y los chunks stale de Turbopack rompen el arranque (`MODULE_UNPARSABLE`). Si ya pasó: `Remove-Item .next -Recurse -Force`.

Ejecutar: `npm run test:e2e -- --workers=2 roles.spec.ts`
Esperado: PASAN los 2 tests. (Menos workers a propósito: con los 4 del default, en una máquina cargada el `login()` no ve el shell en 5s y da falsos rojos.)

- [ ] **Step 5: Correr el E2E completo (que el default admin no rompió nada)**

Ejecutar: `npm run test:e2e -- --workers=2`
Esperado: PASA toda la suite, incluido `smoke.spec.ts`, que afirma que el botón «Full» es visible tras el login por defecto.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/auth/stub-login/route.ts tests/e2e/helpers.ts tests/e2e/roles.spec.ts
git commit -m "test(e2e): cubrir el veto del full para un viewer

El stub acepta ?role para poder entrar sin permisos: sigue sin aceptar un
correo, que es la inyección contra la que se protegía la ruta."
```

---

## Task 9: Documentación y verificación final

**Files:**
- Modify: `CLAUDE.md` (secciones «Endpoints», «Auth», «Esquema de Postgres», «Operación»)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Documentar la tabla**

En `CLAUDE.md`, sección «Esquema de Postgres», agregar una fila a la tabla de tablas, después de `login_attempts`:

```markdown
| `users` | Usuarios y roles. `email` PK (siempre en minúsculas), `role` (`admin`\|`viewer`, default `viewer`, con `check`), `name`, `created_at`, `last_login_at`. Se puebla sola en el primer login. `last_login_at` se pisa: no hay historial. |
```

- [ ] **Step 2: Documentar la autorización**

En la sección «Auth», agregar al final:

```markdown
- **Roles** (spec `docs/superpowers/specs/2026-08-10-gestion-usuarios-roles-design.md`): `admin` y `viewer`, en la tabla `users`, que **es la única fuente de verdad** — el rol NO se cachea en la sesión, porque la cookie dura 7 días y una degradación tardaría eso en surtir efecto. `src/lib/authz.ts` tiene las reglas puras (`canTrigger`, `canCancel`, `roleOrDefault`, `normalizeEmail`), sin importar nada de Next, por el mismo motivo que `google-oauth.ts`. Lo único restringido es el **full sync**: el incremental, los reportes, el export y el Asistente son de todos. El rol no reemplaza a `ALLOWED_EMAIL_DOMAINS`, que sigue siendo la puerta de entrada.
- El **cron conserva permisos plenos** (`Authorization: Bearer $CRON_SECRET`): no tiene persona detrás a quien asignarle rol. Una sesión sin `user.email` (cookie previa a ADR-0008) cae a `viewer`.
```

- [ ] **Step 3: Documentar los endpoints**

En la sección «Endpoints», reemplazar la descripción de `POST /api/sync` para agregar el 403, y la de `/api/sync/status`:

```markdown
- `POST /api/sync?kind=incremental|full` — … Devuelve **403 `forbidden`** si el rol no alcanza (`full` exige `admin`; el incremental es libre). `DELETE /api/sync` setea flag de cancel, y su permiso depende del sync **en curso**: con un full corriendo exige `admin`.
- `GET /api/sync/status` — estado actual + `perms: {full, cancel}` ya resueltos contra la tabla `users` (protegido por el proxy). Los permisos viajan acá y no en `/api/auth/session` porque `AppShell` es **hijo** de la página y el modal de sync no vería un rol traído por el shell.
```

- [ ] **Step 4: Documentar la operación**

En la sección «Operación», agregar al bloque de scripts:

```bash
node scripts/set-role.cjs <email> <admin|viewer>   # promueve/degrada; crea la fila si esa persona nunca entró
```

Y una nota debajo:

```markdown
> Tras aplicar la migración de `users`, **nadie es admin**: la tabla arranca vacía y
> todos caen a `viewer`, así que el primer `set-role.cjs` es parte del despliegue.
> El incremental del cron no se ve afectado en ningún momento.
```

- [ ] **Step 5: Gate de verificación completo**

Ejecutar: `npm test && npm run lint && npx tsc --noEmit`
Esperado: los tres verdes. **Pegar la salida real**, no un resumen.

- [ ] **Step 6: Revisar el diff completo antes del PR**

Ejecutar: `git diff main...HEAD`
Mostrárselo al usuario: él revisa el diff, no el resumen.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documentar usuarios, roles y el veto del full

Toca esquema, auth y endpoints: sin esto la próxima sesión no sabe que el
rol vive en la tabla y no en la sesión, ni por qué."
```

- [ ] **Step 8: Code review y PR**

Correr `/code-review` sobre el diff y reportar los hallazgos que afecten corrección o los requisitos declarados (ignorar preferencias de estilo). Después, `gh pr create` con: qué cambia, por qué, y cómo verificarlo — incluyendo que la puesta en marcha necesita `supabase db push` seguido de `set-role.cjs`.

---

## Notas de riesgo

- **La migración es aditiva**: `create table if not exists` sobre una tabla que no existe. No toca `pages`, `pages_new`, `sync_state` ni `login_attempts`.
- **`TEST_DATABASE_URL` debe apuntar a un proyecto Supabase dedicado a tests.** `db.pg.test.ts` dropea y trunca tablas; ahora también `users`. Una corrida contra la base real borró el snapshot de 21k filas el 2026-07-13.
- **Ventana sin admin**: entre `supabase db push` y el primer `set-role.cjs` nadie puede correr un full. Es esperado y está documentado en el paso 4 de Task 9.
- **`SyncStatusResponse.next` ya tenía los tipos mal** (dice `string` donde la ruta devuelve `string | null`). Se deja como está: la página de reportes usa su propio tipo local y corregirlo es alcance de otra tarea.
