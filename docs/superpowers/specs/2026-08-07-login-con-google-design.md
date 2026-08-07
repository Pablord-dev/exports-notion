# Login con Google — Diseño

**Fecha:** 2026-08-07 · **Rama:** `feat/google-login` · **Skill:** superpowers:brainstorming

## Objetivo

Reemplazar el password compartido por **inicio de sesión con Google**, de modo que:

1. **La sesión sepa quién entró** (correo y nombre), visible en la UI.
2. **Sólo entren correos de dominios autorizados**, hoy `hiuman.edu.mx` y mañana los
   demás dominios de la organización, sin crear un proyecto de Google Cloud por dominio.
3. Entrar sea un click en vez de buscar el password.

Fuera de alcance, decidido explícitamente: tabla de usuarios, permisos por usuario,
historial de chat por persona, bitácora de accesos, y más proveedores de identidad.

## Decisiones tomadas

| Decisión | Elegido | Alternativa descartada |
|---|---|---|
| Mecánica | **OAuth 2.0 a mano** (Authorization Code + PKCE) sobre la iron-session existente | Auth.js/NextAuth v5; Supabase Auth |
| Password compartido | **Se elimina** — Google es la única puerta | Convivir como respaldo; convivir sólo en local |
| Autorizados | **Lista de dominios** en env var, comparación exacta | Todo un dominio fijo; dominio + invitados por correo |
| Identidad | **Sólo en la cookie** de sesión | Tabla `users`; bitácora de accesos |
| Foto de perfil | **Iniciales**, sin imagen remota | `<img>` a `lh3.googleusercontent.com`; `next/image` + `remotePatterns` |
| `redirect_uri` | **Env var explícita** (`APP_ORIGIN`) | Derivarlo del origin del request |
| Retorno tras login | **Siempre `/`** | `returnTo` en el query string |
| Rate-limit | Se **recicla** `rateLimitLogin` en el callback | Borrarlo con una migración; dejarlo muerto |

### Por qué no Auth.js

Auth.js trae **su propia sesión y su propia cookie**, así que sustituirla implica
reescribir [proxy.ts](../../../src/proxy.ts) y cada `getIronSession` de las rutas de
API: el cambio sería más grande que el feature. Además `next-auth@5` lleva años en
beta y su compatibilidad con **Next 16** habría que verificarla antes de
comprometerse, y los E2E tendrían que aprender a stubear una sesión distinta de la
que ya stubean. Lo que Auth.js resolvería aquí —un proveedor, sin refresh tokens, sin
gestión de usuarios— son las ~60 líneas del flujo, no las que cuestan.

Se reconsideraría si entraran más proveedores, magic links o gestión de sesiones por
dispositivo. Registrado como ADR-0008.

### Por qué un solo proyecto de Google Cloud

El Client ID identifica **la app**, no el dominio de quien entra. Lo que decide es el
*User type* de la pantalla de consentimiento:

- **Internal** → sólo cuentas del Workspace dueño del proyecto. *Eso* sí obligaría a
  un proyecto por dominio.
- **External** → cualquier cuenta de Google, y **nosotros** decidimos quién pasa
  validando el correo del lado del servidor. Es lo que necesitamos.

Con "External" hay que **publicar** la app (en modo *Testing* hay un cap de 100
usuarios de prueba). Publicar **no** requiere la verificación de Google mientras los
scopes sean sólo `openid email profile`, que no son sensibles: no aparece la pantalla
de "app no verificada".

## Arquitectura

### Flujo

```
/  (sin sesión)  →  "Continuar con Google"  →  link a /api/auth/google

GET /api/auth/google
  · state (32 bytes aleatorios) + code_verifier (PKCE, S256)
  · los sella con sealData de iron-session en la cookie `oauth-tx` (httpOnly, 10 min)
  · 302 → accounts.google.com/o/oauth2/v2/auth
            ?client_id&redirect_uri&response_type=code&scope=openid email profile
            &state&code_challenge&code_challenge_method=S256
            &prompt=select_account&access_type=online

GET /api/auth/google/callback?code&state
  · rate-limit por IP (5/15 min)
  · abre `oauth-tx`, compara el state, borra la cookie
  · POST oauth2.googleapis.com/token  (code + code_verifier + client_secret)
  · lee el id_token: aud == client_id, iss de Google, exp > ahora, email_verified === true
  · isAllowedEmail(email, dominios)
  · sesión = { authenticated: true, user: { email, name } }  →  302 a /
  · cualquier fallo → 302 a /?error=<código>, sin sesión
```

`access_type=online` a propósito: **nunca** volvemos a llamar a Google después del
login, así que no hay refresh token que guardar ni renovar. La cookie temporal usa
`sealData`/`unsealData` de iron-session, ya instalada — **no entra ninguna dependencia
nueva**.

### Piezas nuevas

```
src/lib/google-oauth.ts          puro, sin imports de Next (testeable suelto):
                                   authorizeUrl(), exchangeCode(), readIdToken(),
                                   isAllowedEmail(), __setTokenFetcher()
src/app/api/auth/google/route.ts           orquesta: cookie + redirect
src/app/api/auth/google/callback/route.ts  orquesta: cookie + sesión + códigos de error
src/app/api/auth/session/route.ts          GET → { authenticated, user? }
src/app/api/auth/logout/route.ts           POST → destruye la sesión
src/app/api/auth/stub-login/route.ts       sólo con E2E_STUBS=1; 404 si no
```

La costura `__setTokenFetcher()` sigue el patrón de `__setLlmClient` / `__setStore` /
`__setClient`: los tests inyectan un doble en vez de mockear módulos globalmente.

### Piezas que cambian

| Archivo | Cambio |
|---|---|
| [session.ts](../../../src/lib/session.ts) | `SessionData { authenticated?: true; user?: { email: string; name: string } }` |
| [auth.ts](../../../src/lib/auth.ts) | Queda como puro re-export de la sesión: sale `verifyPassword` |
| [config.ts](../../../src/lib/config.ts) | Sale `APP_PASSWORD_HASH`; entran `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS`, `APP_ORIGIN`. De 7 vars obligatorias a **10** |
| [page.tsx](../../../src/app/page.tsx) | El formulario de password → botón de Google + banner de `?error=` |
| [app-shell.tsx](../../../src/app/components/app-shell.tsx) | Pide `/api/auth/session`, muestra iniciales + nombre + correo; el logout va a `POST /api/auth/logout` |
| `src/app/api/login/route.ts` | **Se borra** |
| `package.json` | Sale `bcryptjs`: `auth.ts` era su único consumidor en `src/` |

**`authenticated` se conserva en la sesión.** Es la razón por la que
[proxy.ts](../../../src/proxy.ts) y todas las rutas de API que protege **no se tocan**:
la condición que ya evalúan sigue significando lo mismo. La identidad se suma, no
sustituye.

**`user.name` puede faltar.** Google no garantiza el claim `name` en toda cuenta. Si no
viene, se guarda el correo como nombre: la UI nunca queda con un espacio en blanco
donde debería ir una persona.

**Las tres páginas no se tocan.** Cada una sigue derivando `authed` del 401 de su
endpoint de datos ([page.tsx:72-74](../../../src/app/page.tsx#L72-L74),
[asistente:77](../../../src/app/asistente/page.tsx#L77),
[reports:239](../../../src/app/db/tiempos/reports/page.tsx#L239)). Ese 401 es el manejo
de error del camino de datos y funciona; cambiarlo sería refactor no pedido. El único
consumidor de la identidad es el shell, así que la pide el shell.

`GET /api/auth/session` **no** entra al matcher del proxy: tiene que contestar
`{ authenticated: false }` sin sesión, no 401.

## Seguridad

### Quién pasa

`ALLOWED_EMAIL_DOMAINS=hiuman.edu.mx,otrodominio.com`. La comparación es en minúsculas
contra lo que va **después de la última `@`**, y **exacta**:
`pablo@sub.hiuman.edu.mx` **no** entra salvo que se liste `sub.hiuman.edu.mx`. Un
comodín de subdominios es la clase de laxitud que después nadie recuerda haber
concedido. **Lista vacía = nadie entra**, no "todos entran": si alguien borra la var
por error, el fallo debe ser cerrado.

Un correo que no tenga **exactamente una `@`**, o cuyo dominio quede vacío, devuelve
`false` sin más análisis. La lista se lee separando por comas, con `trim()` y
descartando entradas vacías, para que `a.com, b.com,` no cuente un dominio fantasma.

### Validaciones que no son cosméticas

- **`email_verified` verdadero.** Una cuenta de Workspace siempre lo trae, pero una
  cuenta personal de Google puede tener el correo sin verificar. Sin esto, alguien
  podría registrar una cuenta declarando un correo del dominio sin poseerlo. La
  comparación es explícita (`=== true || === "true"`), nunca por *truthiness*: un
  claim ausente o con cualquier otro valor se trata como no verificado.
- **No confiamos en el claim `hd`.** Es una pista para el selector de cuentas y no
  viene en cuentas personales. Se valida el correo mismo.
- **No verificamos la firma del `id_token`.** Google documenta que un token recibido
  **directamente de su endpoint de token por TLS** ya está autenticado por el canal;
  la verificación de firma es para tokens que llegan de terceros. Por eso no entra
  `jose` ni JWKS. Sí se validan `aud` (== nuestro client_id), `iss` (uno de
  `accounts.google.com` o `https://accounts.google.com` — Google emite ambas formas) y
  `exp`. ⚠️ Esta concesión **sólo vale mientras el token venga del canje directo**: si
  algún día se acepta un `id_token` que llegue por otra vía, hay que verificar la firma.
- **`state` de un solo uso**, TTL 10 min, en cookie sellada. Si falta o no coincide,
  se corta antes de canjear nada.
- **PKCE** con cliente confidencial es cinturón y tirantes, pero son seis líneas y
  cierra el robo del `code` en tránsito.
- **Sin `returnTo`.** El callback siempre redirige a `/`. La forma más simple de no
  tener un open redirect es que el parámetro no exista.

### Errores

Cinco códigos, traducidos por la tarjeta de login: `state` (transacción inválida o
vencida), `google` (el usuario canceló o Google devolvió error), `token` (falló el
canje), `unverified` (correo sin verificar), `domain` (fuera de la lista). El mensaje
**no repite el correo ni el error crudo de Google** — sólo "esa cuenta no está
autorizada".

### El rate-limit se recicla

`rateLimitLogin` y la tabla `login_attempts` pasan a proteger el **callback** (5/15 min
por IP). Ya no hay password que adivinar, pero cada callback con un `code` inventado
hace que **nuestra** función salga a hablar con Google: sin tope es un grifo abierto de
invocaciones de Vercel. Reutilizarlo evita a la vez dejar código muerto y escribir una
migración de borrado de tabla.

### La ruta de stub es lo más peligroso del cambio

`GET /api/auth/stub-login` emite una sesión sin credenciales. Existe porque Playwright
no puede hablar con Google real, y sigue el mismo modelo de confianza que la concesión
que ya tiene `verifyPassword` con `E2E_STUBS`. Mitigaciones:

- **404 salvo `E2E_STUBS === "1"`**, que nunca se define en Vercel.
- **Sin parámetros**: correo fijo `e2e@hiuman.edu.mx`, nada que inyectar.
- **Test dedicado** de que responde 404 con la bandera apagada. Es la regresión que
  más importa de todo el feature.

## Pruebas

| Archivo | Qué cubre |
|---|---|
| `tests/unit/google-oauth.test.ts` | `authorizeUrl`: scopes, `code_challenge_method=S256`, state presente, `prompt=select_account`. `readIdToken`: decodifica bien y **rechaza** `aud` ajeno, `iss` ajeno, `exp` vencido, `email_verified:false`. `isAllowedEmail`: mayúsculas, dominio exacto, **subdominio rechazado**, lista vacía → `false`, correo malformado |
| `tests/integration/auth-google.test.ts` | Con `__setTokenFetcher` falso: camino feliz deja sesión con identidad; `state` que no coincide, dominio fuera de lista y error de Google **no dejan sesión** y redirigen con su código. `stub-login` → 404 sin `E2E_STUBS` |
| `tests/unit/config.test.ts` | Las 10 vars obligatorias; el error lista las faltantes |
| `tests/unit/auth.test.ts` | Se queda sólo la mitad de `sessionOptions`; se va la de `verifyPassword` |
| `tests/e2e/*` | `login()` de [helpers.ts](../../../tests/e2e/helpers.ts) navega al stub en vez de llenar el password; el shell muestra el nombre; logout vuelve a la tarjeta de Google |

`playwright.config.ts` cambia su `STUB_ENV`: sale `APP_PASSWORD_HASH`, entran las
cuatro vars nuevas con valores de relleno (`loadConfig` las exige aunque el stub nunca
hable con Google). ⚠️ Recordar la trampa ya documentada: `next start` pisa el
`process.env` heredado con `.env.local`, así que esos valores sólo surten efecto si
`.env.local` no los define.

## Puesta en marcha (manual, una vez)

1. Google Cloud Console → proyecto → *Google Auth Platform*: User type **External**,
   **publicar** la app, scopes sólo `openid email profile`.
2. *Credentials* → *Create OAuth client ID* → **Web application**. Authorized redirect
   URIs, exactos y sin comodines:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<dominio-de-producción>/api/auth/google/callback`
3. Client ID y secret → `.env.local` y Vercel, junto con `ALLOWED_EMAIL_DOMAINS` y
   `APP_ORIGIN` (`http://localhost:3000` en local, el dominio real en Vercel).
4. **Borrar `APP_PASSWORD_HASH` de Vercel a mano** — el código no toca esa configuración.
5. **Rotar `SESSION_SECRET`.** Si no, las cookies emitidas con el password siguen
   válidas hasta 7 días y pasan el proxy **sin traer `user`**, justo lo que este cambio
   busca eliminar. Rotarlo obliga a todos a entrar de nuevo, que es el punto.

## Límites conocidos

- **Los previews de Vercel se quedan sin login.** Su URL es aleatoria y Google no
  acepta comodines en los redirect URIs. O se acepta, o se le asigna un dominio estable
  a la rama.
- **Una sesión válida sin `user` es posible** durante la transición (cookies emitidas
  antes del deploy). El shell mostraría el nombre vacío. Lo cierra el paso 5 de la
  puesta en marcha; el código lo tolera mostrando el correo vacío en vez de romper.
- **Sin revocación.** Si se le quita el acceso a alguien (sale de la organización), su
  cookie sigue viva hasta 7 días. Cerrarlo de verdad requiere validar contra una lista
  en cada request, y eso implica la tabla de usuarios que quedó fuera de alcance.

## Documentación que se actualiza

- `CLAUDE.md`: §Auth, §Endpoints, el conteo de env vars (7 → 10), la nota del stub E2E.
- `.env.example`, `README.md`, `docs/guides/deploy.md`.
- ADR nuevo: `docs/architecture/adr/0008-login-con-google-sobre-iron-session.md`,
  con el descarte de Auth.js y la concesión de no verificar la firma del `id_token`.
