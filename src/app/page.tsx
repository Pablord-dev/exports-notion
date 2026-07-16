"use client";
// Menú principal: login + lista de bases de Notion disponibles (src/lib/databases.ts).
// Cada tarjeta lleva a su dashboard (/db/<slug>) y a sus reportes (/db/<slug>/reports).
// El backend sigue siendo single-DB: el estado del snapshot (/api/sync/status)
// aplica a la única BD registrada, BD Tiempos.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Spinner } from "@/app/components/spinner";
import { DATABASES } from "@/lib/databases";

type Status = {
  meta: { lastFullAt: string | null; lastIncrementalAt: string | null; count: number };
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
  const [loggingOut, setLoggingOut] = useState(false);

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

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/login", { method: "DELETE" });
      setAuthed(false); setStatus(null);
    } finally { setLoggingOut(false); }
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
    <main className="max-w-2xl mx-auto p-6 sm:p-8 space-y-6">
      <header className="flex items-center justify-between border-b border-border pb-5">
        <h1 className="font-display text-xl font-bold text-fg tracking-tight">ExportNotion</h1>
        <button onClick={logout} disabled={loggingOut}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-blue hover:text-blue disabled:cursor-not-allowed disabled:opacity-60">
          {loggingOut && <Spinner className="h-3.5 w-3.5" />}
          {loggingOut ? "Saliendo…" : "Cerrar sesión"}
        </button>
      </header>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-muted">Bases de datos</h2>
        {DATABASES.map((db) => (
          <div key={db.slug} className="rounded-xl border border-border bg-surface p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="font-display text-lg font-bold text-fg">{db.name}</h3>
                <p className="text-sm text-muted">{db.description}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-xl font-bold text-sky tabular-nums">
                  {(status?.meta.count ?? 0).toLocaleString("es-MX")}
                </p>
                <p className="text-xs text-muted whitespace-nowrap">registros · sync {fmtAgo(status?.meta.lastIncrementalAt ?? status?.meta.lastFullAt ?? null)}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link href={`/db/${db.slug}/reports`}
                    className="rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white transition hover:brightness-110">
                Reportes
              </Link>
              <Link href={`/db/${db.slug}`}
                    className="rounded-lg border border-blue px-4 py-2 text-sm font-medium text-blue transition hover:bg-blue hover:text-white">
                Exportar y sincronizar
              </Link>
            </div>
          </div>
        ))}
        <p className="pt-1 text-sm text-muted">Próximamente más bases de datos.</p>
      </section>
    </main>
  );
}
