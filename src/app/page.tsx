"use client";
// Menú principal: login + lista de bases de Notion disponibles (src/lib/databases.ts).
// Cada tarjeta es un link a la página de su BD (/db/<slug>/reports), que
// concentra reportes + export/sync en modals.
// El backend sigue siendo single-DB: el estado del snapshot (/api/sync/status)
// aplica a la única BD registrada, BD Tiempos.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, MessageSquare } from "lucide-react";
import { AppShell } from "@/app/components/app-shell";
import { Spinner } from "@/app/components/spinner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DATABASES } from "@/lib/databases";

type Status = {
  meta: { lastFullAt: string | null; lastIncrementalAt: string | null; count: number };
};

// Icono de cada BD del menú, por slug (default: sin icono).
const DB_ICONS: Record<string, React.ReactNode> = {
  tiempos: <Clock className="h-5 w-5 shrink-0" />,
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
      <main className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <form onSubmit={login} className="space-y-6">
            <CardHeader>
              <CardTitle className="font-display text-2xl font-bold tracking-tight">ExportNotion</CardTitle>
              <CardDescription>Reportes y exportación de bases de Notion.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                     placeholder="Contraseña" autoFocus />
              {loginErr && <p className="text-sm font-medium text-danger">{loginErr}</p>}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={loggingIn} className="w-full">
                {loggingIn && <Spinner />}
                {loggingIn ? "Entrando…" : "Entrar"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </main>
    );
  }

  return (
    <AppShell onLogout={() => { setAuthed(false); setStatus(null); setJustLoggedIn(false); }}
              tour={{ id: "menu" }} justLoggedIn={justLoggedIn}>
    <main className="max-w-2xl mx-auto p-6 sm:p-8 space-y-6">
      <header className="border-b border-border pb-5">
        <h1 className="font-display text-xl font-bold text-foreground tracking-tight">Reportes Notion</h1>
      </header>

      <Link href="/asistente" data-tour="menu-asistente" className="block">
        <Card className="flex flex-row items-center gap-4 p-5 transition hover:border-sky hover:bg-card/80">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue/15 text-sky">
            <MessageSquare className="h-5 w-5 shrink-0" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg font-bold text-foreground">Asistente IA</h3>
            <p className="text-sm text-muted-foreground">Pregunta en lenguaje natural sobre tus bases de datos.</p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Card>
      </Link>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Bases de datos</h2>
        {DATABASES.map((db, i) => (
          <Link key={db.slug} href={`/db/${db.slug}/reports`}
                data-tour={i === 0 ? "menu-db-card" : undefined}
                className="block">
            <Card className="p-5 transition hover:border-sky hover:bg-card/80">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
                    <span className="text-sky">{DB_ICONS[db.slug]}</span>
                    {db.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">{db.description}</p>
                </div>
                <div className="text-right">
                  <p className="whitespace-nowrap font-display text-xl font-bold text-sky tabular-nums">
                    {(status?.meta.count ?? 0).toLocaleString("es-MX")}
                    <span className="ml-1.5 text-sm font-medium">registros</span>
                  </p>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">sync {fmtAgo(status?.meta.lastIncrementalAt ?? status?.meta.lastFullAt ?? null)}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        <p className="pt-1 text-sm text-muted-foreground">Próximamente más bases de datos.</p>
      </section>
    </main>
    </AppShell>
  );
}
