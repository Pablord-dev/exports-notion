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
