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
  const [status, setStatus] = useState<Status | null>(null);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [, setTick] = useState(0);

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

  async function login(e: React.FormEvent) {
    e.preventDefault(); setLoginErr(null);
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    if (r.ok) { setPassword(""); loadStatus(); }
    else setLoginErr(r.status === 429 ? "Demasiados intentos, espera 15 min." : "Contraseña incorrecta.");
  }

  async function trigger(kind: "incremental" | "full") {
    await fetch(`/api/sync?kind=${kind}`, { method: "POST" });
    loadStatus();
  }

  function downloadHref() {
    const p = new URLSearchParams();
    if (from) p.set("from", from); if (to) p.set("to", to);
    return `/api/export?${p.toString()}`;
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
          <button className="w-full bg-black text-white rounded py-2">Entrar</button>
        </form>
      </main>
    );
  }

  const running = status?.status.state === "running";

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold">ExportNotion</h1>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-medium">Última sincronización</h2>
        <p>Full: {fmtAgo(status?.meta.lastFullAt ?? null)}</p>
        <p>Incremental: {fmtAgo(status?.meta.lastIncrementalAt ?? null)}</p>
        <p>Registros en cache: {status?.meta.count ?? 0}</p>
      </section>

      {running ? (
        <section className="border rounded p-4">
          <h2 className="font-medium mb-2">Sync en progreso ({status?.status.kind})</h2>
          <p>{status?.status.done} / {status?.status.total}</p>
          {status?.status.skipped ? <p className="text-sm text-amber-700">Omitidos: {status.status.skipped}</p> : null}
        </section>
      ) : (
        <section className="border rounded p-4 space-y-2">
          <h2 className="font-medium">Próximas sincronizaciones</h2>
          <p>Incremental en {status ? fmtCountdown(status.next.incremental) : "—"}</p>
          <p>Full en {status ? fmtCountdown(status.next.full) : "—"}</p>
          <div className="flex gap-2 pt-2">
            <button onClick={() => trigger("incremental")} className="bg-black text-white rounded px-3 py-2">Refrescar incremental</button>
            <button onClick={() => trigger("full")} className="border rounded px-3 py-2">Full</button>
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
        <a href={downloadHref()} className="inline-block bg-black text-white rounded px-3 py-2">Descargar</a>
      </section>
    </main>
  );
}
