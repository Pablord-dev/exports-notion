# Panel de configuración y gestión de usuarios

**Fecha:** 2026-08-11 · **Rama:** `feat/pantallas-admin` · **Estado:** aprobado, listo para plan

## Problema

Los roles existen desde el 2026-08-10 (spec `2026-08-10-gestion-usuarios-roles-design.md`), pero
sólo se pueden administrar por consola: `node scripts/set-role.cjs <email> <rol>`. Ese spec dejó
explícitamente fuera de alcance la «pantalla de gestión de usuarios dentro de la app». Esto la
construye.

Dos consecuencias del estado actual:

1. **Promover o degradar a alguien exige acceso al repo y a `.env.local`.** Quien administra la
   app no necesariamente tiene una terminal con el proyecto clonado.
2. **No hay forma de ver quién entró.** La tabla `users` guarda `name`, `role`, `created_at` y
   `last_login_at`, y nadie los mira nunca.

## Decisión

Un **panel de configuración** que se abre desde el footer de la sesión, con secciones. Una de
ellas —**Usuarios**— es la tabla administrable, y sólo la ven los admins. No hay ruta nueva: el
panel es un modal, disponible desde cualquier página autenticada.

Las acciones sobre un usuario son dos: **cambiar su rol** y **borrar su fila**. Dar de alta a
alguien que nunca entró queda fuera (§7).

---

## 1. Menú del footer de la sesión

El bloque de identidad de `src/app/components/app-shell.tsx` (iniciales + nombre + correo) hoy es
texto inerte con un botón de logout al lado. Pasa a ser el **disparador de un `DropdownMenu`**, y
el icono suelto de logout desaparece: se muda adentro del menú.

| Item | Acción |
|---|---|
| ⚙ Configuración | Abre el modal en la sección «Cuenta» |
| ? Ayuda | Abre el mismo modal, directo en «Acerca de» |
| *(separador)* | |
| ↪ Cerrar sesión | El `logout()` que ya existe, con su estado `loggingOut` |

Los tres items funcionan. No hay entradas decorativas en el menú: el único bloque marcado
«próximamente» vive dentro de la sección Cuenta, donde se lee como una promesa y no como un botón
roto.

`dropdown-menu` **no existe todavía** en `src/components/ui/`: se genera con la CLI de shadcn y
después se ajusta como código propio, igual que se hizo con `tooltip.tsx`.

---

## 2. Modal de configuración

Componente nuevo, `src/app/components/settings/settings-modal.tsx`. **No se reúsa `AppModal`**:
ese es deliberadamente no-modal (`modal={false}`) y está anclado a `top-10` porque el onboarding
guiado necesita clickear su popover con el modal abierto. Acá se quiere lo contrario —grande y
centrado— y no hay tour que convivir.

- `Dialog` normal (modal), `sm:max-w-3xl`, alto `min(620px, 85vh)`.
- Nav de secciones a la izquierda (≈180px), panel de contenido a la derecha con scroll propio.
- Debajo de `sm` la nav se vuelve una tira horizontal arriba del contenido.
- La sección activa es estado local del modal. Abrir por «Configuración» la inicializa en
  `cuenta`; abrir por «Ayuda», en `acerca`. Es la primera sección para todos: el orden no depende
  del rol, sólo la presencia de Usuarios.

### Secciones

| Sección | Quién la ve | Contenido |
|---|---|---|
| **Cuenta** | todos | Iniciales, nombre, correo y rol propio. Un bloque «próximamente» para preferencias. |
| **Usuarios** | sólo admin | La tabla administrable (§4). |
| **Acerca de** | todos | Producto, para qué sirve, y el último sync (`meta.lastIncrementalAt ?? meta.lastFullAt`). |

Cuenta no muestra desde cuándo la persona tiene acceso: ese dato (`created_at`) no viaja en
`/api/auth/session` y no vale un endpoint ni un campo más sólo para una línea de texto. Sí aparece
en la tabla de Usuarios, que trae la fila completa.

Para el último sync de «Acerca de», el shell guarda la `meta` completa del fetch a
`/api/sync/status` que **ya hace** para el badge de registros, en vez de quedarse sólo con
`meta.count` como hoy. Cero fetches nuevos.

Al viewer la sección Usuarios **no se le renderiza**. Esto es deliberadamente distinto del botón
de Full sync, que al viewer sí se le muestra vedado con tooltip: ahí el control existe para él en
un contexto donde podría esperarlo, y callarlo confundiría. Una sección entera de administración
que no le corresponde no necesita explicación.

Cuenta y Acerca de leen datos que el shell ya tiene o que ya se poleaban; ninguna sección nueva
agrega un fetch al abrir el modal, salvo Usuarios, que pide su lista al entrar.

---

## 3. Cómo sabe la UI el rol

`GET /api/auth/session` gana un campo `role`:

```
{ authenticated: true, user: {...}, role: "admin" | "viewer" }
```

Se lee **de la tabla** en cada request, no de la cookie. La decisión del spec anterior sigue
firme: el rol no se sella en la sesión porque la cookie dura 7 días y una degradación tardaría
eso en surtir efecto.

El lookup va envuelto en `try/catch` y cae a `viewer`, por el mismo motivo por el que lo está el
`recordLogin` del callback: una tabla caída no puede tumbar el shell, y el modo degradado quita
permisos en vez de regalarlos. Sin sesión la respuesta no cambia: `{ authenticated: false }`, sin
tocar la base.

Esta ruta sigue **fuera** del matcher de `proxy.ts`, como está documentado: tiene que poder
contestar `authenticated: false` en vez de 401.

La regla de visibilidad es una función pura nueva en `src/lib/authz.ts`, que corre igual en el
cliente y en el server porque ese archivo no importa nada de Next:

```
canManageUsers(role)  →  role === "admin"
```

---

## 4. Sección Usuarios

### Tabla

| Columna | Contenido |
|---|---|
| Persona | Nombre (o el correo si Google no mandó `name`) sobre el correo en menor jerarquía |
| Rol | `Select` con `admin` / `viewer`; cambiarlo dispara el `PATCH` |
| Último acceso | Fecha relativa; «nunca» si `last_login_at` es null |
| *(acción)* | Icono de borrar |

Orden: por `last_login_at` descendente, con los que nunca entraron al final
(`order by last_login_at desc nulls last`).

Después de cada acción exitosa la tabla **refetchea entera** en vez de mutar el estado local. Son
decenas de filas: la simplicidad vale más que el ahorro.

### La fila propia

El `Select` y el botón de borrar de tu propia fila van **vedados con tooltip** («No podés cambiar
tu propio rol» / «No podés borrar tu propio usuario»), no ocultos: el control existe en todas las
demás filas y hacerlo desaparecer sólo en la tuya se leería como un error de dibujo.

⚠️ Se implementa con `aria-disabled` y el `onClick` cortado, **no** con el atributo `disabled`: un
control deshabilitado no emite eventos de puntero y el tooltip que explica el veto nunca
aparecería. Misma trampa ya documentada para el botón de Full sync.

### Borrado

Confirmación **en la propia fila** (la fila se reemplaza por «¿Borrar a X? Sí / Cancelar»), no en
un segundo diálogo: un `Dialog` de Radix anidado dentro de otro trae problemas de foco y de
dismiss que no vale la pena pelear por una confirmación de una línea.

La copy dice la verdad incómoda: **borrar la fila no le quita el acceso a nadie.** La puerta sigue
siendo `ALLOWED_EMAIL_DOMAINS`, y `recordLogin` recrea la fila —como `viewer`— la próxima vez que
esa persona entre. Lo que el borrado sí hace es quitarle el rol de admin y sacarla de la lista.

---

## 5. Endpoint

Uno solo, `src/app/api/admin/users/route.ts`, con tres verbos. Sin ruta dinámica: un correo en el
path obliga a codificar y decodificar, y no compra nada.

| Verbo | Entrada | Respuesta |
|---|---|---|
| `GET` | — | `{ users: UserRow[] }` |
| `PATCH` | body `{ email, role }` | `{ ok: true }` |
| `DELETE` | query `?email=` | `{ ok: true }` |

### Protección en dos capas

1. **`src/proxy.ts`**: `/api/admin` se suma a `PROTECTED` y `/api/admin/:path*` al matcher. Sin
   sesión → 401 `unauthorized`.
2. **La handler**: resuelve el rol con `getUserRole` y aplica `canManageUsers`. Sin permiso → 403
   `forbidden`.

⚠️ El gate de rol **no lleva `try/catch`**, a diferencia de `/api/auth/session` y del callback.
Mismo criterio que `/api/sync`: en el punto que decide un permiso, un error de base tiene que
cerrar la puerta, no dejarla pasar.

### Reglas y códigos de error

Segunda regla pura nueva en `authz.ts`:

```
canEditUser(actorEmail, targetEmail)  →  normalizeEmail(actor) !== normalizeEmail(target)
```

Cubre a la vez cambiar rol y borrar, y tiene una consecuencia que conviene nombrar: como nadie
puede degradarse ni borrarse a sí mismo, **nunca puede quedar la app sin ningún admin**. No hace
falta contar admins ni una regla especial de «último admin».

| Situación | Respuesta |
|---|---|
| Sin sesión | 401 `unauthorized` (proxy) |
| Sesión de viewer | 403 `forbidden` |
| `email` ausente o vacío | 400 `bad_request` |
| `role` distinto de `admin`/`viewer` | 400 `bad_role` |
| El target es uno mismo | 409 `self` |

`PATCH` sobre un correo sin fila **crea la fila** con ese rol: es el comportamiento de
`setUserRole`, el mismo que ya tiene `scripts/set-role.cjs`. La UI no expone esa vía (no hay campo
para escribir un correo), y crear una fila no le da acceso a nadie —la puerta es el dominio—, así
que no se agrega una validación de existencia sólo para prohibirlo.

---

## 6. Datos

### `Store`

Dos métodos nuevos en `src/lib/store-shared.ts`, implementados en `src/lib/db.ts` (Postgres) y en
`src/lib/memory-store.ts` (memoria, para tests y `E2E_STUBS=1`):

| Método | Devuelve | Notas |
|---|---|---|
| `listUsers()` | `UserRow[]` | `order by last_login_at desc nulls last`. |
| `deleteUser(email)` | `void` | Normaliza el email en la frontera, como los otros tres. Borrar a alguien inexistente es un no-op, no un error. |

```ts
export interface UserRow {
  email: string;
  role: Role;
  name: string | null;
  createdAt: string;      // ISO
  lastLoginAt: string | null;  // ISO, null = nunca entró
}
```

**No hay migración nueva.** La tabla `users` ya tiene todas las columnas que esto necesita.

---

## 7. Fuera de alcance

- **Dar de alta a alguien que nunca entró desde la UI.** El endpoint lo permitiría como efecto de
  `setUserRole`, pero no se expone un campo para escribir correos. Quien lo necesite usa el
  script.
- **Un tercer rol, o permisos más finos que admin/viewer.** Lo único que el rol decide sigue
  siendo el Full sync y ahora esta pantalla.
- **Historial de logins.** `last_login_at` se pisa: se sabe cuándo entró alguien por última vez,
  no cuántas veces.
- **Que las secciones «próximamente» hagan algo.**
- **Bloquear el acceso de una persona concreta.** Requiere una allowlist por correo o un flag de
  baja en la tabla; hoy la puerta es el dominio y este trabajo no la toca.

---

## 8. Pruebas

**Unit — `tests/unit/authz.test.ts`** (se suma a los casos existentes)
- `canManageUsers`: `admin` sí, `viewer` no.
- `canEditUser`: correos distintos sí; el mismo correo no; el mismo correo con distinta grafía
  (`Pablo@` vs `pablo@`) **tampoco** — si esta pasara, un admin se degradaría a sí mismo
  escribiendo su correo en mayúsculas.

**Integración — `tests/integration/admin-users.test.ts`** (handler real contra `memory-store`,
mismo molde que `sync-authz.test.ts`: `vi.hoisted` + mock de `iron-session` y `next/headers`)
- Viewer: 403 en `GET`, `PATCH` y `DELETE`.
- Admin: `GET` lista, `PATCH` cambia el rol, `DELETE` borra la fila.
- Admin sobre sí mismo: 409 en `PATCH` y en `DELETE`, y la fila queda intacta.
- `PATCH` con `role: "superadmin"`: 400.
- `DELETE` sin `?email=`: 400.
- Sesión sin `user.email` (cookie previa a ADR-0008): 403.

**Integración — `tests/integration/session-role.test.ts`**
- Con sesión y fila `admin`, `/api/auth/session` devuelve `role: "admin"`.
- Sin fila, devuelve `viewer`.
- Si `getUserRole` lanza, la respuesta sigue siendo 200 con `role: "viewer"` y se registra el
  error.

**Casos compartidos — `tests/fixtures/userCases.ts`** (corren contra memoria y contra el SQL real
de `tests/integration/db.pg.test.ts`)
- `listUsers` devuelve las filas con sus cinco campos y en el orden acordado, con los que nunca
  entraron al final.
- `deleteUser` borra una y deja el resto; borrar dos veces no lanza.

**E2E — `tests/e2e/roles.spec.ts`** (se suma a los dos casos que ya tiene)
- Admin: abre el menú del footer → Configuración → sección Usuarios → cambia un rol y la tabla lo
  refleja.
- Viewer: abre el mismo menú y entra a Configuración; la sección Usuarios no está.

### Tests existentes que hay que reapuntar

Mudar el logout adentro del menú rompe tres lugares, y hay que arreglarlos como parte del trabajo,
no después:

| Test | Cambio |
|---|---|
| `tests/e2e/smoke.spec.ts:14` | Abrir el menú antes de esperar el item «Cerrar sesión» |
| `tests/e2e/onboarding.spec.ts:126` y `:147` | Igual: abrir el menú antes del clic |
| `tests/e2e/smoke.spec.ts:126` | Prueba el **tooltip** del botón de logout. Un item de menú no lleva tooltip, así que ese test pierde su sujeto: se reapunta al botón «Ocultar menú», que sigue siendo un botón de icono con tooltip. |

---

## 9. Documentación

`CLAUDE.md` se actualiza en el mismo trabajo:

- El endpoint `/api/admin/users` en la lista de endpoints, con sus códigos de error.
- `/api/auth/session` ahora devuelve `role`.
- El matcher de `proxy.ts` incluye `/api/admin`.
- La sección de Páginas describe el menú del footer y el modal de configuración, y por qué no
  reúsa `AppModal`.
- La sección de Auth suma `canManageUsers` y `canEditUser`, y la consecuencia de que nadie pueda
  operar sobre sí mismo (nunca queda cero admins).
- `scripts/set-role.cjs` sigue siendo la vía para el primer admin: la pantalla exige ser admin
  para verse, así que la puesta en marcha de un despliegue nuevo no cambia.
