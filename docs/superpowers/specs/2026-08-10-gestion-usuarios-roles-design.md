# Gestión de usuarios y roles

**Fecha:** 2026-08-10 · **Rama:** `feat/gestion-usuarios-roles` · **Estado:** aprobado, listo para plan

## Problema

Hoy la única puerta de la app es el dominio del correo (`ALLOWED_EMAIL_DOMAINS`). Quien pasa ese
filtro tiene exactamente los mismos poderes que cualquier otro: `src/proxy.ts` sólo pregunta
"¿hay sesión?" y `/api/sync` acepta cualquier cookie válida. De ahí salen los dos dolores
concretos que motivan este trabajo:

1. **Cualquiera puede disparar un Full sync.** Un Full reconstruye el snapshot de ~21k filas,
   encadena hasta 20 invocaciones desde el navegador y tarda varios minutos. Alguien que lo lanza
   sin saber qué hace deja la base a medio construir durante ese rato.
2. **No hay registro de quién tiene acceso.** No existe una lista de personas que hayan entrado
   alguna vez, ni cuándo lo hicieron por última vez.

Lo que **no** motiva este trabajo: el costo de tokens del Asistente IA. Se descartó
explícitamente durante el brainstorming — `/api/chat` no se toca.

## Decisión

Dos roles, `admin` y `viewer`, en una tabla nueva de Postgres que se puebla sola en el primer
login. El rol **no reemplaza** el gate de dominio: es una capa aparte que diferencia qué puede
hacer alguien que ya entró.

Lo único restringido es el **Full sync**. El incremental sigue libre para cualquier sesión, y
todo lo demás (reportes, export CSV, Asistente IA) es lectura para todos.

---

## 1. Modelo de datos

Migración nueva en `supabase/migrations/`. Archivo aparte: la migración existente ya está
aplicada en la base cloud y no se modifica.

```sql
create table if not exists users (
  email         text primary key,
  role          text not null default 'viewer' check (role in ('admin','viewer')),
  name          text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
```

Dos columnas más allá del boceto original, cada una con su razón:

- **`name`** — hace que la consulta de auditoría se lea sola
  (`select name, email, last_login_at from users order by last_login_at desc nulls last`),
  y el dato ya viene gratis en el ID token de Google.
- **`check (role in …)`** — un typo en el script falla en la base en vez de crear un tercer rol
  fantasma que ninguna regla contempla.

**Normalización de email:** siempre en minúsculas, antes de escribir y antes de consultar. Sin
esto, `Pablo@dominio` y `pablo@dominio` son dos filas distintas, y un admin promovido con una
grafía puede volver a entrar con la otra y no serlo.

La normalización vive en `normalizeEmail` (ver §2) y la aplican **las dos implementaciones del
`Store` en su frontera**, no quienes las llaman: hay tres puntos de entrada (callback, ruta de
sync, script) y dejar la responsabilidad afuera garantiza que tarde o temprano uno se olvide. El
script normaliza por su cuenta además, porque va por SQL directo sin pasar por el `Store`.

### Interfaz `Store`

Tres métodos nuevos en `src/lib/store-shared.ts`, implementados en `src/lib/db.ts` (Postgres) y
en `src/lib/memory-store.ts` (memoria, para tests y `E2E_STUBS=1`):

| Método | Devuelve | Notas |
|---|---|---|
| `recordLogin(email, name)` | `void` | `insert … on conflict do update set last_login_at = now(), name = excluded.name`. Crea la fila en el primer login y refresca el timestamp en los siguientes. **El `role` queda fuera del `do update`**: un login posterior nunca degrada a un admin de vuelta al default. No devuelve el rol porque nadie lo necesita en ese punto — el callback ya no sella nada (§2). |
| `getUserRole(email)` | `Role \| null` | El `null` (sesión viva de alguien sin fila) lo interpreta quien llama como `viewer`. |
| `setUserRole(email, role)` | `void` | Lo usa el script de operación. |

### Script de operación

`scripts/set-role.cjs`, con el molde exacto de `scripts/reset-sync-state.cjs`: lee
`DATABASE_URL` de `.env.local`, habla SQL directo, no pasa por la app.

```bash
node scripts/set-role.cjs pablo.sanchez@hiuman.edu.mx admin
```

La tabla es la única fuente de verdad de los roles. Cambiar un admin no requiere redeploy ni
tocar variables de entorno.

---

## 2. Autorización

### El rol no viaja en la sesión

Durante el brainstorming se barajó un esquema híbrido (rol sellado en la cookie para la UI,
consulta a la base para el gate). Se descartó al escribirlo: si el gate consulta la tabla igual,
el rol de la cookie no autoriza nada — sólo pinta UI — y además queda viejo hasta 7 días, así que
promover a alguien lo dejaría sin ver el botón hasta cerrar sesión.

**La tabla es la única fuente de verdad en las dos direcciones.** `SessionData` no cambia. El
costo es un lookup por clave primaria sobre una tabla de decenas de filas, en endpoints que no
son calientes.

### Reglas puras

`src/lib/authz.ts`, sin importar nada de Next — mismo criterio que `src/lib/google-oauth.ts`, y
por el mismo motivo: la orquestación tiene que poder testearse fuera de un request.

```
type Role = "admin" | "viewer"

normalizeEmail(email)        →  email.trim().toLowerCase()
roleOrDefault(role | null)   →  role ?? "viewer"

canTrigger(role, kind)       →  kind === "incremental"  ||  role === "admin"
canCancel(role, runningKind) →  runningKind !== "full"  ||  role === "admin"
```

`roleOrDefault` existe para que la conversión «sin fila en la tabla ⇒ viewer» sea una decisión
con nombre y con test, en vez de un `?? "viewer"` repetido en cada punto de uso.

`canCancel` depende de lo que está corriendo, no de quién lanzó qué: cancelar es un solo botón
que aborta el sync en curso. Un viewer puede frenar el incremental que él mismo disparó, pero no
puede tirar abajo el Full de un admin a mitad de camino.

### Aplicación en `/api/sync`

`isAuthorized` deja de devolver un booleano y pasa a devolver **quién es**:

```
{ via: "cron" } | { via: "session", email } | null
```

- **`cron`** conserva permisos plenos. Es el canal que dispara el incremental diario declarado en
  `vercel.json` y no tiene una persona detrás a quien asignarle un rol.
- **`session`** consulta el rol con `getUserRole` y aplica la regla.
- Denegado responde **403 `forbidden`**, deliberadamente distinto del **401 `unauthorized`** de
  no autenticado: son dos problemas distintos y el cliente los trata distinto.

El `DELETE` lee `getStatus()` para saber qué está corriendo antes de decidir. Sin nada corriendo,
pasa (es un no-op).

Una sesión sin `user.email` — cookies emitidas antes de ADR-0008, que `src/lib/session.ts`
documenta como posibles — cae a `viewer`.

---

## 3. UI

### Los permisos viajan en `/api/sync/status`

Motivo estructural: quien consulta `/api/auth/session` es `src/app/components/app-shell.tsx`, y
el shell es **hijo** de la página. El modal de sync vive en la página, así que un rol traído por
el shell no le llega — el mismo motivo por el que el tour entra por props del `AppShell`.

Antes que hacer un segundo `fetch` del mismo endpoint desde la página, el permiso se suma al
payload que la página **ya está poleando** (cada 2s durante un sync, cada 30s en reposo):

```
GET /api/sync/status  →  { …, perms: { full: boolean, cancel: boolean } }
```

La UI no interpreta roles: obedece booleanos. La decisión vive en un único lugar, el server.

`perms.cancel` es `true` cuando no hay nada corriendo — el `DELETE` en ese estado es un no-op y
no hay motivo para pintarlo como prohibido.

### Modal de sync

| Control | Comportamiento |
|---|---|
| Refrescar incremental | Sin cambios para nadie. |
| Full | Con `perms.full` falso: deshabilitado, con tooltip «Requiere permisos de administrador». |
| Cancelar | Con `perms.cancel` falso: mismo tratamiento. Sólo ocurre si hay un Full corriendo y quien mira es viewer. |

⚠️ **Un `<button disabled>` no emite eventos de puntero, así que el tooltip de Radix no
aparece** — el control quedaría gris y mudo, que es exactamente lo que el tratamiento elegido
busca evitar. Se implementa con `aria-disabled` y el `onClick` cortado, en vez del atributo
`disabled`. El botón sigue anunciándose como deshabilitado a un lector de pantalla y conserva el
foco, así que también se llega por teclado.

El 403 del server es la red de seguridad, no el mecanismo: al viewer no se le explica el permiso
mediante un error después de hacer clic.

---

## 4. Pruebas

**Unit — `tests/unit/authz.test.ts`**
- Tabla de verdad completa de `canTrigger` y `canCancel` (4 casos cada una).
- `roleOrDefault(null)` da `viewer`; `roleOrDefault("admin")` no lo pisa.
- `normalizeEmail` baja a minúsculas y recorta espacios.

**Integración — `/api/sync` contra `memory-store`**
- Viewer: 403 en `kind=full`, 200 en `kind=incremental`.
- Admin: 200 en ambos.
- Bearer del cron: 200 en ambos, sin consultar la tabla.
- `DELETE` con un Full corriendo: 403 para viewer, 200 para admin.
- `DELETE` con un incremental corriendo: 200 para viewer.

**Integración SQL — `tests/integration/db.pg.test.ts`** (gated por `TEST_DATABASE_URL`)
- `recordLogin` crea la fila la primera vez y actualiza `last_login_at` sin duplicar la segunda.
- `setUserRole` cambia el rol y `recordLogin` posterior lo respeta (no lo pisa con el default).
- `users` se suma a las listas de `drop` y `truncate` de ese archivo. Sin esto, la corrida deja
  filas que ensucian la siguiente.

**E2E — `tests/e2e/`**
- Viewer: el botón Full se ve, está deshabilitado y muestra el tooltip al pasar el puntero.
- Admin: el botón Full está utilizable.
- Para poder entrar como viewer, `GET /api/auth/stub-login` acepta `?role=viewer`. La ruta
  **escribe ese rol con `setUserRole` antes de sellar la sesión**, así que el parámetro es la
  autoridad y no compite con ningún sembrado previo del memory-store; sin el parámetro escribe
  `admin`, y por eso los E2E actuales siguen pasando sin tocarlos. Un valor que no sea
  `admin` ni `viewer` se responde 400 en vez de caer a un default silencioso.
- Esto relaja el «sin parámetros a propósito» que documenta esa ruta, pero ese comentario protege
  contra **inyectar identidad**: el correo sigue fijo, la ruta ya emite una sesión sin
  credenciales, y no existe fuera de `E2E_STUBS=1`.
- ⚠️ Para cerrar un tooltip de Radix en Playwright, `mouse.move` necesita `steps` (el cierre
  sigue el `pointermove`; un salto de un solo evento no lo dispara).

---

## 5. Fuera de alcance

Nada de esto entra en esta tanda. Cada uno se puede sumar después sin migrar lo que se construye
acá:

- Tracking o límite de tokens del Asistente IA por persona.
- Historial de logins (`login_events` append-only). `last_login_at` pisa el valor anterior: se
  sabe cuándo entró alguien por última vez, no cuántas veces entró.
- Pantalla de gestión de usuarios dentro de la app.
- Roles por base de datos (hoy el backend es single-DB de todas formas — MB-02 en `docs/to-dos.md`).
- Cualquier cambio al gate de dominio: `ALLOWED_EMAIL_DOMAINS` sigue siendo la puerta de entrada
  y no se toca.

---

## 6. Puesta en marcha

1. `supabase db push` — aplica la migración a la base cloud.
2. `node scripts/set-role.cjs <tu-email> admin` — el primer admin.

**Entre el paso 1 y el paso 2 nadie puede correr un Full:** la tabla arranca vacía, todos caen a
`viewer`. El incremental diario del cron no se ve afectado en ningún momento, porque el bearer
conserva permisos plenos.
