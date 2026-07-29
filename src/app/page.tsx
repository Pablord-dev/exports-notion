"use client";
// Menú principal: login + lista de bases de Notion disponibles (src/lib/databases.ts).
// Cada tarjeta es un link a la página de su BD (/db/<slug>/reports), que
// concentra reportes + export/sync en modals.
// El backend sigue siendo single-DB: el estado del snapshot (/api/sync/status)
// aplica a la única BD registrada, BD Tiempos.
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { Spinner } from "@/app/components/spinner";
import { DATABASES } from "@/lib/databases";

type Status = {
  meta: { lastFullAt: string | null; lastIncrementalAt: string | null; count: number };
};

function ClockIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h13a2 2 0 012 2z" />
    </svg>
  );
}

// Icono de cada BD del menú, por slug (default: sin icono).
const DB_ICONS: Record<string, React.ReactNode> = {
  tiempos: <ClockIcon />,
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
      if (r.ok) { setPassword(""); await loadStatus(); }
      else setLoginErr(r.status === 429 ? "Demasiados intentos, espera 15 min." : "Contraseña incorrecta.");
    } finally { setLoggingIn(false); }
  }

  if (authed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center gap-3 text-muted">
        <Spinner className="text-sky" />
        <span className="text-sm">Cargando…</span>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <form onSubmit={login}
              className="w-full max-w-sm bg-surface rounded-2xl border border-border p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold text-fg tracking-tight">ExportNotion</h1>
            <p className="text-sm text-muted">Reportes y exportación de bases de Notion.</p>
          </div>
          <div className="space-y-2">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                   className="w-full rounded-lg border border-border bg-dark-blue px-3 py-2.5 text-fg placeholder:text-muted outline-none transition focus:border-blue focus:ring-2 focus:ring-blue/30"
                   placeholder="Contraseña" autoFocus />
            {loginErr && <p className="text-sm font-medium text-danger">{loginErr}</p>}
          </div>
          <button disabled={loggingIn}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue py-2.5 text-sm font-medium text-white transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-blue/40 disabled:cursor-not-allowed disabled:opacity-60">
            {loggingIn && <Spinner />}
            {loggingIn ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <AppShell onLogout={() => { setAuthed(false); setStatus(null); }} tour={{ id: "menu" }}>
    <main className="max-w-2xl mx-auto p-6 sm:p-8 space-y-6">
      <header className="border-b border-border pb-5">
        <h1 className="font-display text-xl font-bold text-fg tracking-tight">Reportes Notion</h1>
      </header>

      <Link href="/asistente" data-tour="menu-asistente"
            className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5 transition hover:border-sky hover:bg-surface/80">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue/15 text-sky"><ChatIcon /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold text-fg">Asistente IA</h3>
          <p className="text-sm text-muted">Pregunta en lenguaje natural sobre tus bases de datos.</p>
        </div>
        <svg className="h-5 w-5 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      </Link>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-muted">Bases de datos</h2>
        {DATABASES.map((db, i) => (
          <Link key={db.slug} href={`/db/${db.slug}/reports`}
                data-tour={i === 0 ? "menu-db-card" : undefined}
                className="block rounded-xl border border-border bg-surface p-5 transition hover:border-sky hover:bg-surface/80">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 font-display text-lg font-bold text-fg">
                  <span className="text-sky">{DB_ICONS[db.slug]}</span>
                  {db.name}
                </h3>
                <p className="text-sm text-muted">{db.description}</p>
              </div>
              <div className="text-right">
                <p className="whitespace-nowrap font-display text-xl font-bold text-sky tabular-nums">
                  {(status?.meta.count ?? 0).toLocaleString("es-MX")}
                  <span className="ml-1.5 text-sm font-medium">registros</span>
                </p>
                <p className="text-xs text-muted whitespace-nowrap">sync {fmtAgo(status?.meta.lastIncrementalAt ?? status?.meta.lastFullAt ?? null)}</p>
              </div>
            </div>
          </Link>
        ))}
        <p className="pt-1 text-sm text-muted">Próximamente más bases de datos.</p>
      </section>
    </main>
    </AppShell>
  );
}
