"use client";
// Menú principal: login + lista de bases de Notion disponibles (src/lib/databases.ts).
// Cada tarjeta de BD lleva sus acciones en el footer (Ver reportes / Exportar CSV);
// la tarjeta del Asistente sigue siendo un link completo.
// El backend sigue siendo single-DB: el estado del snapshot (/api/sync/status)
// aplica a la única BD registrada, BD Tiempos.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, Download, Lock, MessageSquare } from "lucide-react";
import { AppShell } from "@/app/components/app-shell";
import { Spinner } from "@/app/components/spinner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [justLoggedIn, setJustLoggedIn] = useState(false);

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

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (loggingIn) return;
    setLoginErr(null); setLoggingIn(true);
    try {
      const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      if (r.ok) { setPassword(""); setJustLoggedIn(true); await loadStatus(); }
      else setLoginErr(r.status === 429 ? "Demasiados intentos, espera 15 min." : "Contraseña incorrecta.");
    } finally { setLoggingIn(false); }
  }

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
        <Card className="w-full max-w-sm p-6">
          <form onSubmit={login} className="space-y-3.5">
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-[10.5px] font-semibold uppercase tracking-widest text-subtle">
                Contraseña compartida
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                       placeholder="Contraseña" autoFocus className="h-10 bg-background pl-9" />
              </div>
              {loginErr && <p className="text-sm font-medium text-danger">{loginErr}</p>}
            </div>
            <Button type="submit" disabled={loggingIn} className="h-10 w-full">
              {loggingIn && <Spinner />}
              {loggingIn ? "Entrando…" : "Entrar"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">5 intentos cada 15 minutos.</p>
          </form>
        </Card>
        <p className="text-[11px] text-subtle">iU Corp · herramienta interna</p>
      </main>
    );
  }

  const lastSync = status?.meta.lastIncrementalAt ?? status?.meta.lastFullAt ?? null;

  return (
    <AppShell onLogout={() => { setAuthed(false); setStatus(null); setJustLoggedIn(false); }}
              tour={{ id: "menu" }} justLoggedIn={justLoggedIn}>
    <main className="mx-auto max-w-[75rem] space-y-6 px-6 py-7 sm:px-8">
      <header className="space-y-1 border-b border-border pb-5">
        <p className="text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Panel</p>
        <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">Menú principal</h1>
        <p className="text-[12.5px] text-muted-foreground">Bases de Notion disponibles para reportar y exportar.</p>
      </header>

      <div className="max-w-2xl space-y-4">
        {DATABASES.map((db, i) => (
          <Card key={db.slug} data-tour={i === 0 ? "menu-db-card" : undefined} className="gap-0 overflow-hidden p-0">
            <div className="flex items-start justify-between gap-6 p-5">
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-sky">
                    {DB_ICONS[db.slug]}
                  </span>
                  <h3 className="text-[15px] font-semibold text-foreground">{db.name}</h3>
                </div>
                <p className="max-w-[44ch] text-[13px] leading-relaxed text-muted-foreground">{db.description}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-[32px] font-extrabold leading-none tracking-tight text-sky tabular-nums">
                  {(status?.meta.count ?? 0).toLocaleString("es-MX")}
                </p>
                <p className="mt-1.5 text-[11.5px] uppercase tracking-wider text-subtle">registros</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 border-t border-border px-5 py-3">
              <Button asChild size="sm">
                <Link href={`/db/${db.slug}/reports`} aria-label={`Ver reportes de ${db.name}`}>
                  Ver reportes
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="border-border-strong">
                <Link href={`/db/${db.slug}/reports?modal=export`}>
                  <Download className="h-3.5 w-3.5" />
                  Exportar CSV
                </Link>
              </Button>
              <span className="ml-auto text-[11.5px] text-subtle">Sincronizado {fmtAgo(lastSync)}</span>
            </div>
          </Card>
        ))}

        <Link href="/asistente" data-tour="menu-asistente" className="block">
          <Card className="flex flex-row items-center gap-4 p-5 transition hover:border-border-strong hover:bg-card/80">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-sky">
              <MessageSquare className="h-4 w-4 shrink-0" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold text-foreground">Asistente IA</h3>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">Pregunta en lenguaje natural sobre tus bases de datos.</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Card>
        </Link>

        <p className="pt-1 text-[12.5px] text-subtle">Próximamente más bases de datos.</p>
      </div>
    </main>
    </AppShell>
  );
}
