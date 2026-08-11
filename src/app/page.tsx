"use client";
// Menú principal: login + grilla de accesos a lo que ofrece la app.
// La grilla ocupa el ancho real del contenedor (3 columnas desde xl, apilada
// abajo). Cada celda es un link completo — la BD abarca dos columnas y lleva
// a sus reportes, el Asistente es el tile de una columna — y una tira
// punteada anuncia las BDs por venir.
// El backend sigue siendo single-DB: el estado del snapshot (/api/sync/status)
// aplica a la única BD registrada, BD Tiempos.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Clock, MessageSquare, Plus } from "lucide-react";
import { AppShell } from "@/app/components/app-shell";
import { Spinner } from "@/app/components/spinner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DATABASES } from "@/lib/databases";

type Status = {
  meta: { lastFullAt: string | null; lastIncrementalAt: string | null; count: number };
};

// Icono de cada BD del menú, por slug (default: sin icono).
const DB_ICONS: Record<string, React.ReactNode> = {
  tiempos: <Clock className="h-4 w-4 shrink-0" />,
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

// Tile de una columna: link completo con icono, copy y llamada a la acción.
// h-full para que iguale la altura de la fila; sin min-h, así el bloque no
// crece más de lo que pide su contenido.
function ActionTile({ href, tour, icon, title, body, cta }: {
  href: string; tour?: string; icon: React.ReactNode; title: string; body: string; cta: string;
}) {
  return (
    <Link href={href} data-tour={tour} className="group block">
      <Card className="flex h-full flex-col gap-0 p-4 transition group-hover:border-border-strong group-hover:bg-card/80">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-sky">
            {icon}
          </span>
          <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
        <span className="mt-auto flex items-center gap-1 pt-2.5 text-[12.5px] font-medium text-link">
          {cta}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 transition group-hover:translate-x-0.5" />
        </span>
      </Card>
    </Link>
  );
}

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
  blocked: "Un administrador retiró tu acceso a esta herramienta.",
  servidor: "No se pudo completar el ingreso. Vuelve a intentarlo en un momento.",
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

// useSearchParams obliga a un límite de Suspense: al prerender, los search
// params no existen todavía y next build aborta la página sin él. El fallback
// replica la rama de carga de Home, así el primer paint no cambia de forma.
export default function Page() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="text-sky" />
        <span className="text-sm">Cargando…</span>
      </main>
    }>
      <Home />
    </Suspense>
  );
}

function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const params = useSearchParams();
  // Object.hasOwn y no un lookup directo: ?error=constructor resolvería por la
  // cadena de prototipos a una función, que React no puede renderizar.
  const errorCode = params.get("error") ?? "";
  const authError = Object.hasOwn(ERROR_MESSAGES, errorCode) ? ERROR_MESSAGES[errorCode] : null;

  async function loadStatus() {
    const r = await fetch("/api/sync/status");
    if (r.status === 401) { setAuthed(false); return; }
    setAuthed(true);
    if (r.ok) setStatus(await r.json());
  }
  // Fetch inicial del status al montar: el setState ocurre tras el await (async),
  // no sincrónicamente — la regla no distingue ese caso.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadStatus(); }, []);

  // El callback de Google vuelve con ?bienvenida=1: es lo único que distingue
  // "acabo de entrar" de "recargué con la cookie viva". Se lee una vez y se
  // limpia de la URL — si el parámetro se quedara, cada F5 volvería a ofrecer el
  // recorrido, que es justo lo que la key de localStorage evita.
  useEffect(() => {
    if (params.get("bienvenida") !== "1") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJustLoggedIn(true);
    window.history.replaceState({}, "", "/");
  }, [params]);

  if (authed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="text-sky" />
        <span className="text-sm">Cargando…</span>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
        {/* Marca tipográfica fuera de la tarjeta, sobre el canvas */}
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue font-display text-[15px] font-extrabold tracking-tight text-white" aria-hidden>
            iU
          </div>
          <div className="text-center">
            <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">iU Notion Reports</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Reportes y exportación de bases de Notion</p>
          </div>
        </div>
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
        <p className="text-[11px] text-subtle">iU Corp · herramienta interna</p>
      </main>
    );
  }

  const lastSync = status?.meta.lastIncrementalAt ?? status?.meta.lastFullAt ?? null;

  return (
    <AppShell onLogout={() => { setAuthed(false); setStatus(null); setJustLoggedIn(false); }}
              tour={{ id: "menu" }} justLoggedIn={justLoggedIn}>
    <main className="mx-auto max-w-[75rem] space-y-5 px-6 py-7 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-1 border-b border-border pb-4">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Panel</p>
          <h1 className="mt-1 font-display text-[22px] font-bold tracking-tight text-foreground">Menú principal</h1>
        </div>
        <p className="text-[12.5px] text-muted-foreground">Bases de Notion disponibles para reportar y exportar.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        {DATABASES.map((db, i) => (
          <Link key={db.slug} href={`/db/${db.slug}/reports`} data-tour={i === 0 ? "menu-db-card" : undefined}
                aria-label={`Ver reportes de ${db.name}`} className="group block xl:col-span-2">
            <Card className="flex h-full flex-col gap-0 overflow-hidden p-0 transition group-hover:border-border-strong group-hover:bg-card/80">
              <div className="flex flex-1 items-start justify-between gap-6 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-sky">
                      {DB_ICONS[db.slug]}
                    </span>
                    <h3 className="text-[15px] font-semibold text-foreground">{db.name}</h3>
                  </div>
                  <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-muted-foreground">{db.description}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-[28px] font-extrabold leading-none tracking-tight text-sky tabular-nums">
                    {(status?.meta.count ?? 0).toLocaleString("es-MX")}
                  </p>
                  <p className="mt-1 text-[11.5px] uppercase tracking-wider text-subtle">registros</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border px-4 py-2.5">
                <span className="flex items-center gap-1 text-[12.5px] font-medium text-link">
                  Ver reportes
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 transition group-hover:translate-x-0.5" />
                </span>
                <span className="ml-auto text-[11.5px] text-subtle">Sincronizado {fmtAgo(lastSync)}</span>
              </div>
            </Card>
          </Link>
        ))}

        <ActionTile href="/asistente" tour="menu-asistente"
                    icon={<MessageSquare className="h-4 w-4 shrink-0" />}
                    title="Asistente IA"
                    body="Pregunta en lenguaje natural y responde consultando los mismos reportes."
                    cta="Abrir chat" />

        {/* Tira punteada, no tile: anuncia lo que viene sin robar alto */}
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-dashed border-border px-4 py-3 text-center xl:col-span-3">
          <Plus className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
          <p className="text-[12.5px] font-medium text-muted-foreground">Próximamente más bases de datos</p>
          <p className="text-[12px] text-subtle">— cada base registrada aparece aquí con sus reportes y su exportación.</p>
        </div>
      </div>
    </main>
    </AppShell>
  );
}
