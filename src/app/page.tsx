"use client";
import { useEffect, useState } from "react";

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

  if (authed === null) return <main className="p-8">Cargando…</main>;

  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <form onSubmit={login} className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold">ExportNotion</h1>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 className="w-full border rounded px-3 py-2" placeholder="Contraseña" autoFocus />
          {loginErr && <p className="text-sm text-red-600">{loginErr}</p>}
          <button disabled={loggingIn}
                  className="w-full bg-black text-white rounded py-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {loggingIn ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </main>
    );
  }

  const running = status?.status.state === "running";

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">ExportNotion</h1>
        <button onClick={logout} disabled={loggingOut}
                className="text-sm border rounded px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed">
          {loggingOut ? "Saliendo…" : "Cerrar sesión"}
        </button>
      </div>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-medium">Última sincronización</h2>
        <p>Full: {fmtAgo(status?.meta.lastFullAt ?? null)}</p>
        <p>Incremental: {fmtAgo(status?.meta.lastIncrementalAt ?? null)}</p>
        <p>Registros en cache: {status?.meta.count ?? 0}</p>
      </section>

      {running ? (
        <section className="border rounded p-4 space-y-2">
          <h2 className="font-medium">Sync en progreso ({status?.status.kind})</h2>
          <p>{status?.status.done} / {status?.status.total}</p>
          {status?.status.skipped ? <p className="text-sm text-amber-700">Omitidos: {status.status.skipped}</p> : null}
          <button onClick={cancel} disabled={cancelling}
                  className="border rounded px-3 py-2 disabled:opacity-50">
            {cancelling ? "Cancelando…" : "Cancelar y guardar lo cargado"}
          </button>
        </section>
      ) : (
        <section className="border rounded p-4 space-y-2">
          <h2 className="font-medium">Próximas sincronizaciones</h2>
          <p>Incremental en {status ? fmtCountdown(status.next.incremental) : "—"}</p>
          <p>Full en {status ? fmtCountdown(status.next.full) : "—"}</p>
          <div className="flex gap-2 pt-2">
            <button onClick={() => trigger("incremental")} disabled={triggering !== null}
                    className="bg-black text-white rounded px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {triggering === "incremental" ? "Iniciando…" : "Refrescar incremental"}
            </button>
            <button onClick={() => trigger("full")} disabled={triggering !== null}
                    className="border rounded px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {triggering === "full" ? "Iniciando…" : "Full"}
            </button>
          </div>
        </section>
      )}

      <section className="border rounded p-4 space-y-3">
        <h2 className="font-medium">Descargar CSV</h2>
        <div className="flex gap-3">
          <label className="flex-1">Desde
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block w-full border rounded px-2 py-1" />
          </label>
          <label className="flex-1">Hasta
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block w-full border rounded px-2 py-1" />
          </label>
        </div>
        <button onClick={download} disabled={downloading}
                className="inline-block bg-black text-white rounded px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {downloading ? "Descargando…" : "Descargar"}
        </button>
        {downloadErr && <p className="text-sm text-red-600">{downloadErr}</p>}
      </section>
    </main>
  );
}
