"use client";
import { useEffect, useState } from "react";

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-4 w-4 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Cargando"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

type Status = {
  status: { state: "idle"|"running"|"error"; kind: "incremental"|"full"|null; done: number; total: number; error: string | null; skipped: number; };
  meta: { lastFullAt: string | null; lastIncrementalAt: string | null; count: number; };
  next: { incremental: string; full: string; };
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  return `hace ${h} h`;
}
function fmtCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [, setTick] = useState(0);
  const [triggering, setTriggering] = useState<"incremental" | "full" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  async function loadStatus() {
    const r = await fetch("/api/sync/status");
    if (r.status === 401) { setAuthed(false); return; }
    setAuthed(true);
    setStatus(await r.json());
  }
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    if (!authed) return;
    const i = setInterval(() => setTick((x) => x + 1), 1000);
    const j = setInterval(() => loadStatus(), status?.status.state === "running" ? 2000 : 30000);
    return () => { clearInterval(i); clearInterval(j); };
  }, [authed, status?.status.state]);

  // Cuando arranca un sync nuevo (vemos state=running), dejamos de mostrar "Iniciando…".
  useEffect(() => { if (status?.status.state === "running") setTriggering(null); }, [status?.status.state]);

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

  async function trigger(kind: "incremental" | "full") {
    if (triggering) return;
    setTriggering(kind);
    try {
      // Loop hasta que el server reporte done:true. Para incremental siempre es true en el primer call;
      // para full cada call procesa un segmento (~35 s) y devuelve done:false si falta más.
      // Máximo 20 segmentos (= ~200k registros) como tope defensivo.
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await fetch(`/api/sync?kind=${kind}`, { method: "POST" });
        await loadStatus();
        if (!res.ok) break;
        const body = await res.json().catch(() => ({}));
        if (body.done) break;
      }
    } finally {
      setTriggering(null);
    }
  }
  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    try { await fetch("/api/sync", { method: "DELETE" }); }
    finally { await loadStatus(); setCancelling(false); }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/login", { method: "DELETE" });
      setAuthed(false); setStatus(null);
    } finally { setLoggingOut(false); }
  }

  async function download() {
    if (downloading) return;
    setDownloading(true); setDownloadErr(null);
    try {
      const p = new URLSearchParams();
      if (from) p.set("from", from); if (to) p.set("to", to);
      const res = await fetch(`/api/export?${p.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDownloadErr(body.message ?? body.error ?? `Error ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename="?([^"]+)"?/i);
      const fname = m?.[1] ?? `export-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) { setDownloadErr(e?.message ?? "Falló la descarga"); }
    finally { setDownloading(false); }
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
            <p className="text-sm text-muted">Exporta los datos de Notion a CSV.</p>
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

  const running = status?.status.state === "running";

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

      <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <h2 className="font-display text-base font-semibold text-fg">Última sincronización</h2>
        <dl className="grid grid-cols-3 gap-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Full</dt>
            <dd className="text-sm text-fg">{fmtAgo(status?.meta.lastFullAt ?? null)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Incremental</dt>
            <dd className="text-sm text-fg">{fmtAgo(status?.meta.lastIncrementalAt ?? null)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Registros</dt>
            <dd className="font-display text-xl font-bold text-sky">{status?.meta.count ?? 0}</dd>
          </div>
        </dl>
      </section>

      {running ? (
        <section className="rounded-xl border border-sky/40 bg-surface p-5 space-y-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Spinner className="text-sky" />
            Sync en progreso <span className="font-sans text-sm font-normal text-muted">({status?.status.kind})</span>
          </h2>
          <p className="font-display text-xl font-bold text-fg">
            {status?.status.done} <span className="text-muted">/ {status?.status.total}</span>
          </p>
          {status?.status.skipped ? <p className="text-sm font-medium text-warning">Omitidos: {status.status.skipped}</p> : null}
          <button onClick={cancel} disabled={cancelling}
                  className="flex items-center gap-2 rounded-lg border border-danger px-3 py-2 text-sm font-medium text-danger transition hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
            {cancelling && <Spinner className="h-3.5 w-3.5" />}
            {cancelling ? "Cancelando…" : "Cancelar y guardar lo cargado"}
          </button>
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-fg">Próximas sincronizaciones</h2>
          <div className="flex gap-8">
            <p className="text-sm text-muted">Incremental en <span className="font-medium text-fg tabular-nums">{status ? fmtCountdown(status.next.incremental) : "—"}</span></p>
            <p className="text-sm text-muted">Full en <span className="font-medium text-fg tabular-nums">{status ? fmtCountdown(status.next.full) : "—"}</span></p>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => trigger("incremental")} disabled={triggering !== null}
                    className="flex items-center gap-2 rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
              {triggering === "incremental" && <Spinner className="h-3.5 w-3.5" />}
              {triggering === "incremental" ? "Iniciando…" : "Refrescar incremental"}
            </button>
            <button onClick={() => trigger("full")} disabled={triggering !== null}
                    className="flex items-center gap-2 rounded-lg border border-blue px-4 py-2 text-sm font-medium text-blue transition hover:bg-blue hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
              {triggering === "full" && <Spinner className="h-3.5 w-3.5" />}
              {triggering === "full" ? "Iniciando…" : "Full"}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <h2 className="font-display text-base font-semibold text-fg">Descargar CSV</h2>
        <div className="flex gap-3">
          <label className="flex-1 text-sm text-muted">Desde
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                   className="mt-1 block w-full rounded-lg border border-border bg-dark-blue px-3 py-2 text-sm text-fg outline-none transition [color-scheme:dark] focus:border-blue focus:ring-2 focus:ring-blue/30" />
          </label>
          <label className="flex-1 text-sm text-muted">Hasta
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                   className="mt-1 block w-full rounded-lg border border-border bg-dark-blue px-3 py-2 text-sm text-fg outline-none transition [color-scheme:dark] focus:border-blue focus:ring-2 focus:ring-blue/30" />
          </label>
        </div>
        <button onClick={download} disabled={downloading}
                className="flex items-center gap-2 rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
          {downloading && <Spinner className="h-3.5 w-3.5" />}
          {downloading ? "Descargando…" : "Descargar"}
        </button>
        {downloadErr && <p className="text-sm font-medium text-danger">{downloadErr}</p>}
      </section>
    </main>
  );
}
