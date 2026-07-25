"use client";
// Página principal de la BD: reportes (filtros combinables, evolución temporal,
// horas por persona y por subproyecto con drill-down) + exportación y
// sincronización en modals no bloqueantes (el viejo dashboard /db/tiempos se
// fusionó aquí; esa ruta ahora redirige). Datos: /api/reports/* y /api/sync/status.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FlatRow } from "@/lib/types";
import { REPORT_PROPS, type PersonTotal, type SubprojectTotal, type TimelineBucket, type MatrixCell, type FilterOptions } from "@/lib/store-shared";
import { AppShell } from "@/app/components/app-shell";
import { Breadcrumb } from "@/app/components/breadcrumb";
import { BarChart, MultiSelect, Spinner, fmtHours } from "./components";

type Granularity = "month" | "week";
interface Filters {
  from: string; to: string;
  people: string[]; subprojects: string[]; projects: string[]; companies: string[];
}
interface Detail {
  title: string;
  params: URLSearchParams;
  rows: FlatRow[];
  nextCursor: string | null;
  loading: boolean;
}

function filterParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  for (const v of f.people) p.append("person", v);
  for (const v of f.subprojects) p.append("subproject", v);
  for (const v of f.projects) p.append("project", v);
  for (const v of f.companies) p.append("company", v);
  return p;
}

// timeZone UTC: las fechas del snapshot y los filtros viven en UTC; formatear
// en zona local corre los días (2026-07-01 se vería como "30 jun" en CDMX).
const fmtDate = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";

// Encabezado de columna de semana (lunes ISO), compacto: "01 jun 26".
const fmtWeek = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });

// Dimensiones cuyo valor y etiqueta coinciden (todas menos Persona).
const asOptions = (vals: string[] | undefined) => (vals ?? []).map((v) => ({ value: v, label: v }));

// Mapa de calor: fondo sky del brandbook (#02B5D3) con intensidad según el
// valor relativo al máximo de la tabla. Escala sqrt para que los valores
// medios no desaparezcan; alfa máx 0.45 mantiene legible el texto claro.
const heatBg = (value: number, max: number): string | undefined =>
  max > 0 && value > 0 ? `rgba(2, 181, 211, ${(0.45 * Math.sqrt(value / max)).toFixed(3)})` : undefined;

// ---- Estado del snapshot / sync (heredado del viejo dashboard) ----
type LastResult = {
  kind: "incremental" | "full";
  upserted: number;
  deleted: number;
  skipped: number;
  finishedAt: string;
};
type SyncStatus = {
  status: { state: "idle"|"running"|"error"; kind: "incremental"|"full"|null; done: number; total: number; error: string | null; skipped: number; lastResult?: LastResult | null; };
  meta: { lastFullAt: string | null; lastIncrementalAt: string | null; count: number; };
  next: { incremental: string; full: string; };
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
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

export default function Reports() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  // Sin rango por default: el reporte abre mostrando TODOS los registros.
  const [filters, setFilters] = useState<Filters>({
    from: "", to: "",
    people: [], subprojects: [], projects: [], companies: [],
  });
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [byPerson, setByPerson] = useState<PersonTotal[]>([]);
  const [bySubproject, setBySubproject] = useState<SubprojectTotal[]>([]);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [matrix, setMatrix] = useState<MatrixCell[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  // ---- Export/sync en modals (fusionado del viejo dashboard) ----
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [modal, setModal] = useState<null | "export" | "sync">(null);
  const [triggering, setTriggering] = useState<"incremental" | "full" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [, setTick] = useState(0);

  const running = syncStatus?.status.state === "running";

  const loadSyncStatus = useCallback(async () => {
    const r = await fetch("/api/sync/status");
    if (!r.ok) return;
    const s: SyncStatus = await r.json();
    setSyncStatus(s);
    // Cuando arranca un sync nuevo (vemos state=running), dejamos de mostrar "Iniciando…".
    if (s.status.state === "running") setTriggering(null);
  }, []);

  // Poll del estado del snapshot: rápido durante un sync, relajado en idle.
  useEffect(() => {
    if (!authed) return;
    // El setState ocurre tras el await (async), no sincrónicamente — la regla
    // no distingue ese caso (mismo patrón aceptado en el resto de páginas).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSyncStatus();
    const j = setInterval(() => void loadSyncStatus(), running ? 2000 : 30000);
    return () => clearInterval(j);
  }, [authed, running, loadSyncStatus]);

  // Tick por segundo solo con el modal de sync abierto (mueve las cuentas regresivas).
  useEffect(() => {
    if (modal !== "sync") return;
    const i = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [modal]);

  async function trigger(kind: "incremental" | "full") {
    if (triggering) return;
    setTriggering(kind);
    try {
      // Loop hasta que el server reporte done:true. Para incremental siempre es true en el primer call;
      // para full cada call procesa un segmento (~35 s) y devuelve done:false si falta más.
      // Máximo 20 segmentos (= ~200k registros) como tope defensivo.
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await fetch(`/api/sync?kind=${kind}`, { method: "POST" });
        await loadSyncStatus();
        if (!res.ok) break;
        const body = await res.json().catch(() => ({}));
        if (body.done) break;
      }
    } finally {
      setTriggering(null);
    }
  }
  async function cancelSync() {
    if (cancelling) return;
    setCancelling(true);
    try { await fetch("/api/sync", { method: "DELETE" }); }
    finally { await loadSyncStatus(); setCancelling(false); }
  }

  async function download() {
    if (downloading) return;
    setDownloading(true); setDownloadErr(null);
    try {
      const p = new URLSearchParams();
      if (exportFrom) p.set("from", exportFrom);
      if (exportTo) p.set("to", exportTo);
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
    } catch (e) { setDownloadErr(e instanceof Error ? e.message : "Falló la descarga"); }
    finally { setDownloading(false); }
  }

  // Catálogo de filtros una sola vez; su 401 decide si hay sesión.
  useEffect(() => {
    (async () => {
      const r = await fetch("/api/reports/filters");
      if (r.status === 401) { setAuthed(false); return; }
      setAuthed(true);
      // Un error no-401 (p. ej. base caída) no debe romper la página: los
      // dropdowns quedan vacíos y el fetch de datos reporta el error visible.
      if (r.ok) setOptions(await r.json());
    })();
  }, []);

  // Válido si falta alguna cota (rango abierto) o si from <= to.
  const rangeValid = !filters.from || !filters.to || filters.from <= filters.to;

  // El filtro Persona guarda IDs; para títulos se resuelve el nombre visible.
  const personName = (id: string) => options?.people.find((p) => p.value === id)?.label ?? id;

  // Reporte dinámico (matriz × semana): aparece con exactamente UNA persona
  // seleccionada (filas = sus subproyectos) o UN subproyecto (filas = sus personas).
  const matrixMode = filters.people.length === 1
    ? { dim: "subproject" as const, title: `Subproyectos por semana · ${personName(filters.people[0])}`, rowLabel: "Subproyecto", nullLabel: "(sin subproyecto)" }
    : filters.subprojects.length === 1
      ? { dim: "person" as const, title: `Personas por semana · ${filters.subprojects[0]}`, rowLabel: "Persona", nullLabel: "(sin persona)" }
      : null;
  const matrixDim = matrixMode?.dim ?? null;

  useEffect(() => {
    if (!authed || !matrixDim || !rangeValid) return;
    let alive = true;
    (async () => {
      setMatrixLoading(true);
      try {
        const q = filterParams(filters).toString();
        const r = await fetch(`/api/reports/matrix?${q}&dim=${matrixDim}`);
        if (!alive) return;
        setMatrix(r.ok ? (await r.json()).cells : []);
      } catch {
        if (alive) setMatrix([]);
      } finally {
        if (alive) setMatrixLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [authed, matrixDim, filters, rangeValid]);

  // Pivote cliente: columnas = semanas presentes, filas ordenadas por total desc.
  const matrixView = useMemo(() => {
    if (!matrix.length) return null;
    const weeks = [...new Set(matrix.map((c) => c.bucket))].sort();
    const groups = new Map<string | null, Map<string, number>>();
    const labels = new Map<string | null, string | null>();
    for (const c of matrix) {
      if (!groups.has(c.group)) groups.set(c.group, new Map());
      groups.get(c.group)!.set(c.bucket, c.hours);
      if (c.label) labels.set(c.group, c.label);
    }
    const rows = [...groups.entries()]
      .map(([group, cells]) => ({
        group,
        label: labels.get(group) ?? null,
        cells,
        total: [...cells.values()].reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total
        || (a.group === null ? 1 : b.group === null ? -1 : a.group.localeCompare(b.group)));
    const max = Math.max(...matrix.map((c) => c.hours));
    return { weeks, rows, max };
  }, [matrix]);

  const load = useCallback(async () => {
    if (!rangeValid) return;
    setLoading(true); setError(null);
    try {
      const q = filterParams(filters).toString();
      const [p, s, t] = await Promise.all([
        fetch(`/api/reports/by-person?${q}`),
        fetch(`/api/reports/by-subproject?${q}`),
        fetch(`/api/reports/timeline?${q}&granularity=${granularity}`),
      ]);
      if (!p.ok || !s.ok || !t.ok) throw new Error(`Error ${[p, s, t].find((r) => !r.ok)?.status}`);
      setByPerson((await p.json()).rows);
      setBySubproject((await s.json()).rows);
      setTimeline((await t.json()).buckets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los reportes");
    } finally {
      setLoading(false);
    }
  }, [filters, granularity, rangeValid]);

  // El setLoading ocurre dentro de load() tras decisiones async del fetch; mismo
  // patrón aceptado en page.tsx (la regla no distingue ese caso).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (authed) void load(); }, [authed, load]);

  // ---- Drill-down: abre el panel de detalle con filtros extra sobre los vigentes ----
  async function openDetail(title: string, extra: Partial<Record<"person" | "subproject", string>>, range?: { from: string; to: string }) {
    const p = filterParams({ ...filters, ...(range ? { from: range.from, to: range.to } : {}) });
    if (extra.person) { p.delete("person"); p.append("person", extra.person); }
    if (extra.subproject) { p.delete("subproject"); p.append("subproject", extra.subproject); }
    const d: Detail = { title, params: p, rows: [], nextCursor: null, loading: true };
    setDetail(d);
    await loadDetailPage(d);
  }
  async function loadDetailPage(d: Detail) {
    const p = new URLSearchParams(d.params);
    if (d.nextCursor) p.set("cursor", d.nextCursor);
    const r = await fetch(`/api/reports/detail?${p.toString()}`);
    if (!r.ok) { setDetail({ ...d, loading: false }); return; }
    const body: { rows: FlatRow[]; nextCursor: string | null } = await r.json();
    setDetail({ ...d, rows: [...d.rows, ...body.rows], nextCursor: body.nextCursor, loading: false });
  }
  function barToRange(bucket: string): { from: string; to: string } {
    const start = new Date(`${bucket}T00:00:00Z`);
    const end = granularity === "month"
      ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
      : new Date(start.getTime() + 6 * 86_400_000);
    // acotado al rango vigente (si hay cotas) para no salirse del filtro
    const from = filters.from && bucket < filters.from ? filters.from : bucket;
    const toISO = end.toISOString().slice(0, 10);
    return { from, to: filters.to && toISO > filters.to ? filters.to : toISO };
  }

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetail(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModal(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal]);

  const totals = useMemo(() => ({
    hours: byPerson.reduce((a, r) => a + r.hours, 0),
    count: byPerson.reduce((a, r) => a + r.count, 0),
    people: byPerson.length,
  }), [byPerson]);

  if (authed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center gap-3 text-muted">
        <Spinner className="text-sky" /><span className="text-sm">Cargando…</span>
      </main>
    );
  }
  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-fg">Reportes</h1>
          <p className="text-sm text-muted">Necesitas iniciar sesión para consultar los reportes.</p>
          <Link href="/" className="inline-block rounded-lg bg-blue px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110">
            Ir al inicio de sesión
          </Link>
        </div>
      </main>
    );
  }

  const inputCls = "mt-1 block w-full rounded-lg border border-border bg-dark-blue px-3 py-2 text-sm text-fg outline-none transition [color-scheme:dark] focus:border-blue focus:ring-2 focus:ring-blue/30";

  return (
    <AppShell onLogout={() => setAuthed(false)}>
    <main className="max-w-7xl mx-auto p-4 sm:p-5 space-y-5">
      <header className="space-y-2 border-b border-border pb-5">
        <Breadcrumb items={[{ label: "Menú", href: "/" }, { label: "BD Tiempos" }]} />
        <h1 className="font-display text-xl font-bold text-fg tracking-tight">BD Tiempos</h1>
      </header>

      {/* Snapshot: registros + última sync + acciones (abren modals no bloqueantes) */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="whitespace-nowrap font-display text-xl font-bold text-sky tabular-nums">
              {(syncStatus?.meta.count ?? 0).toLocaleString("es-MX")}
              <span className="ml-1.5 text-sm font-medium">registros</span>
            </p>
            {running ? (
              <p className="flex items-center gap-2 text-xs font-medium text-sky">
                <Spinner className="h-3 w-3" />
                Sincronizando ({syncStatus?.status.kind}): {syncStatus?.status.done} / {syncStatus?.status.total}
              </p>
            ) : (
              <p className="text-xs text-muted">
                Última sincronización {fmtAgo(syncStatus?.meta.lastIncrementalAt ?? syncStatus?.meta.lastFullAt ?? null)}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setModal("export")}
                    className="rounded-lg border border-blue px-4 py-2 text-sm font-medium text-blue transition hover:bg-blue hover:text-white">
              Exportar
            </button>
            <button onClick={() => setModal("sync")}
                    className="rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white transition hover:brightness-110">
              Sincronizar
            </button>
          </div>
        </div>
      </section>

      {/* Título de la sección de reportes, ya con el snapshot arriba */}
      <div className="flex items-baseline gap-4 pt-2">
        <h2 className="font-display text-lg font-bold text-fg tracking-tight">Reportes</h2>
        <span className="text-sm text-muted">
          {!filters.from && !filters.to
            ? "Todos los registros"
            : filters.from && filters.to
              ? `${fmtDate(filters.from)} — ${fmtDate(filters.to)}`
              : filters.from
                ? `Desde ${fmtDate(filters.from)}`
                : `Hasta ${fmtDate(filters.to)}`}
        </span>
      </div>

      {/* Filtros: una fila, rango + 4 dimensiones */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="text-sm text-muted">Desde
            <input type="date" value={filters.from} max={filters.to}
                   onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={inputCls} />
          </label>
          <label className="text-sm text-muted">Hasta
            <input type="date" value={filters.to} min={filters.from}
                   onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={inputCls} />
          </label>
          <div className="pt-6"><MultiSelect label="Persona" options={options?.people ?? []} selected={filters.people}
                                             onChange={(v) => setFilters({ ...filters, people: v })} /></div>
          <div className="pt-6"><MultiSelect label="Subproyecto" options={asOptions(options?.subprojects)} selected={filters.subprojects}
                                             onChange={(v) => setFilters({ ...filters, subprojects: v })} /></div>
          <div className="pt-6"><MultiSelect label="Proyecto" options={asOptions(options?.projects)} selected={filters.projects}
                                             onChange={(v) => setFilters({ ...filters, projects: v })} /></div>
          <div className="pt-6"><MultiSelect label="Empresa" options={asOptions(options?.companies)} selected={filters.companies}
                                             onChange={(v) => setFilters({ ...filters, companies: v })} /></div>
        </div>
        {!rangeValid && <p className="mt-3 text-sm font-medium text-danger">El rango es inválido: “Desde” es posterior a “Hasta”.</p>}
        {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}
      </section>

      {/* Totales del rango filtrado */}
      <section className="grid grid-cols-3 gap-4">
        {[
          { label: "Horas registradas", value: fmtHours(totals.hours) },
          { label: "Registros", value: totals.count.toLocaleString("es-MX") },
          { label: "Personas activas", value: String(totals.people) },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs uppercase tracking-wide text-muted">{t.label}</p>
            <p className="mt-1 font-display text-2xl font-bold text-sky">{loading ? "…" : t.value}</p>
          </div>
        ))}
      </section>

      {/* Evolución temporal */}
      <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-fg">Evolución de horas</h2>
          <div className="flex rounded-lg border border-border p-0.5 text-sm">
            {(["week", "month"] as const).map((g) => (
              <button key={g} onClick={() => setGranularity(g)}
                      className={`rounded-md px-3 py-1 font-medium transition ${granularity === g ? "bg-blue text-white" : "text-muted hover:text-fg"}`}>
                {g === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
        </div>
        {loading
          ? <div className="flex h-60 items-center justify-center text-muted"><Spinner className="text-sky" /></div>
          : <BarChart buckets={timeline} granularity={granularity}
                      onBarClick={(b) => { const r = barToRange(b); void openDetail(`Registros · ${fmtDate(r.from)} — ${fmtDate(r.to)}`, {}, r); }} />}
      </section>

      {/* Reporte dinámico: matriz dimensión × semana (1 persona o 1 subproyecto) */}
      {matrixMode && (
        <section className="rounded-xl border border-sky/40 bg-surface p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-fg">{matrixMode.title}</h2>
          {matrixLoading ? (
            <div className="flex h-44 flex-col items-center justify-center gap-3 text-muted">
              <Spinner className="h-6 w-6 text-sky" />
              <p className="text-sm">Generando reporte…</p>
            </div>
          ) : !matrixView ? (
            <p className="py-8 text-center text-sm text-muted">Sin registros en el rango seleccionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted">
                    <th className="sticky left-0 bg-surface pb-2 pr-3 font-medium">{matrixMode.rowLabel}</th>
                    {matrixView.weeks.map((w) => (
                      <th key={w} className="whitespace-nowrap px-2 pb-2 text-right font-medium">{fmtWeek(w)}</th>
                    ))}
                    <th className="pb-2 pl-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixView.rows.map((r) => (
                    <tr key={r.group ?? "__sin_grupo__"} className="border-t border-border/60">
                      <td className={`sticky left-0 min-w-44 max-w-72 bg-surface py-2 pr-3 [overflow-wrap:anywhere] ${r.group ? "text-fg" : "italic text-muted"}`}>
                        {/* grupo sin valor: nunca mostrar el label (mezclaría personas) */}
                        {r.group ? (r.label ?? r.group) : matrixMode.nullLabel}
                      </td>
                      {matrixView.weeks.map((w) => {
                        const v = r.cells.get(w);
                        return (
                          <td key={w} style={v ? { backgroundColor: heatBg(v, matrixView.max) } : undefined}
                              className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-fg">
                            {v ? fmtHours(v) : <span className="text-muted/40">—</span>}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap py-2 pl-3 text-right font-medium tabular-nums text-sky">{fmtHours(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tablas de agregados: apiladas, cada una a lo ancho completo */}
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-fg">Horas por persona</h2>
          <AggTable
            head={["Persona", "Horas", "Registros"]}
            empty={loading ? "Cargando…" : "Sin registros en el rango."}
            heatCol={1}
            rows={byPerson.map((r) => {
              // Con ID muestra el nombre (o el ID si el grupo no trae nombre). El grupo
              // SIN relación junta a muchas personas: siempre "(sin persona)", nunca
              // el max() del nombre (etiquetaría a una persona arbitraria).
              const name = r.person ? (r.label ?? r.person) : "(sin persona)";
              return {
                key: r.person || "(sin persona)",
                // sin relación no hay valor por el cual filtrar el detalle
                onClick: r.person ? () => void openDetail(`Registros · ${name}`, { person: r.person }) : undefined,
                cells: [name, fmtHours(r.hours), String(r.count)],
                mutedFirst: !r.person,
                heat: r.hours,
              };
            })} />
        </section>
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-fg">Horas por subproyecto</h2>
          <AggTable
            head={["Subproyecto", "Proyecto", "Horas", "Registros"]}
            empty={loading ? "Cargando…" : "Sin registros en el rango."}
            heatCol={2}
            rows={bySubproject.map((r) => ({
              key: r.subproject ?? "(sin subproyecto)",
              // los registros sin subproyecto no tienen valor por el cual filtrar el detalle
              onClick: r.subproject ? () => void openDetail(`Registros · ${r.subproject}`, { subproject: r.subproject! }) : undefined,
              cells: [r.subproject ?? "(sin subproyecto)", r.project ?? "—", fmtHours(r.hours), String(r.count)],
              mutedFirst: !r.subproject,
              heat: r.hours,
            }))} />
        </section>
      </div>

      {/* Modal de exportación (no bloqueante: click fuera o Esc regresa al reporte) */}
      {modal === "export" && (
        <Modal title="Exportar CSV" onClose={() => setModal(null)}>
          <p className="text-sm text-muted">
            Rango opcional por fecha de creación. Con ambos campos vacíos se exporta todo el snapshot.
          </p>
          <div className="flex gap-3">
            <label className="flex-1 text-sm text-muted">Desde
              <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} className={inputCls} />
            </label>
            <label className="flex-1 text-sm text-muted">Hasta
              <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} className={inputCls} />
            </label>
          </div>
          <button onClick={download} disabled={downloading}
                  className="flex items-center gap-2 rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
            {downloading && <Spinner className="h-3.5 w-3.5" />}
            {downloading ? "Descargando…" : "Descargar"}
          </button>
          {downloadErr && <p className="text-sm font-medium text-danger">{downloadErr}</p>}
        </Modal>
      )}

      {/* Modal de sincronización (no bloqueante) */}
      {modal === "sync" && (
        <Modal title="Sincronización" onClose={() => setModal(null)}>
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Full</dt>
              <dd className="text-sm text-fg">{fmtAgo(syncStatus?.meta.lastFullAt ?? null)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Incremental</dt>
              <dd className="text-sm text-fg">{fmtAgo(syncStatus?.meta.lastIncrementalAt ?? null)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Registros</dt>
              <dd className="font-display text-xl font-bold text-sky">{(syncStatus?.meta.count ?? 0).toLocaleString("es-MX")}</dd>
            </div>
          </dl>
          {syncStatus?.status.lastResult && (
            <p className="border-t border-border pt-3 text-sm text-muted">
              Último sync ({syncStatus.status.lastResult.kind}, {fmtAgo(syncStatus.status.lastResult.finishedAt)}):{" "}
              <span className="font-medium text-fg">{syncStatus.status.lastResult.upserted} actualizados</span>
              {" · "}
              <span className="font-medium text-fg">{syncStatus.status.lastResult.deleted} eliminados</span>
              {syncStatus.status.lastResult.skipped ? (
                <> · <span className="font-medium text-warning">{syncStatus.status.lastResult.skipped} omitidos</span></>
              ) : null}
            </p>
          )}
          {running ? (
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
                <Spinner className="text-sky" />
                Sync en progreso <span className="font-sans font-normal text-muted">({syncStatus?.status.kind})</span>
              </h3>
              <p className="font-display text-xl font-bold text-fg">
                {syncStatus?.status.done} <span className="text-muted">/ {syncStatus?.status.total}</span>
              </p>
              {syncStatus?.status.skipped ? <p className="text-sm font-medium text-warning">Omitidos: {syncStatus.status.skipped}</p> : null}
              <button onClick={cancelSync} disabled={cancelling}
                      className="flex items-center gap-2 rounded-lg border border-danger px-3 py-2 text-sm font-medium text-danger transition hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                {cancelling && <Spinner className="h-3.5 w-3.5" />}
                {cancelling ? "Cancelando…" : "Cancelar y guardar lo cargado"}
              </button>
            </div>
          ) : (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex gap-8">
                <p className="text-sm text-muted">Incremental en <span className="font-medium text-fg tabular-nums">{syncStatus ? fmtCountdown(syncStatus.next.incremental) : "—"}</span></p>
                <p className="text-sm text-muted">Full en <span className="font-medium text-fg tabular-nums">{syncStatus ? fmtCountdown(syncStatus.next.full) : "—"}</span></p>
              </div>
              <div className="flex gap-3">
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
            </div>
          )}
        </Modal>
      )}

      {/* Panel de detalle (drill-down) */}
      {detail && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-dark-blue/80 p-4 sm:p-10"
             onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="w-full max-w-4xl rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-5">
              <h2 className="font-display text-base font-semibold text-fg">{detail.title}</h2>
              <button onClick={() => setDetail(null)}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-blue hover:text-blue">
                Cerrar
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-5">
              {detail.loading && detail.rows.length === 0
                ? <div className="flex justify-center py-10"><Spinner className="text-sky" /></div>
                : detail.rows.length === 0
                  ? <p className="py-8 text-center text-sm text-muted">Sin registros para este corte.</p>
                  : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-muted">
                          <th className="pb-2 pr-3 font-medium">ID</th>
                          <th className="pb-2 pr-3 font-medium">Fecha</th>
                          <th className="pb-2 pr-3 font-medium">Persona</th>
                          <th className="pb-2 pr-3 font-medium">Tarea</th>
                          <th className="pb-2 pr-3 font-medium">Descripción</th>
                          <th className="pb-2 text-right font-medium">Horas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.rows.map((r) => (
                          <tr key={r["ID"]} className="border-t border-border/60 align-top">
                            <td className="py-2 pr-3 whitespace-nowrap text-muted">{r["ID"]}</td>
                            <td className="py-2 pr-3 whitespace-nowrap text-fg">{fmtDate(r["Hora de creación"])}</td>
                            {/* La columna "Persona" muestra el nombre (personLabel), no el ID de la relación */}
                            <td className="py-2 pr-3 text-fg">{r[REPORT_PROPS.personLabel]}</td>
                            <td className="py-2 pr-3 text-fg">{r["Tarea"]}</td>
                            <td className="py-2 pr-3 text-muted">{r["Breve descripción"]}</td>
                            <td className="py-2 text-right font-medium text-sky whitespace-nowrap">{fmtHours(Number(r["Registro de horas"]) || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              {detail.nextCursor && (
                <div className="pt-4 text-center">
                  <button disabled={detail.loading}
                          onClick={() => { setDetail({ ...detail, loading: true }); void loadDetailPage({ ...detail, loading: true }); }}
                          className="rounded-lg border border-blue px-4 py-2 text-sm font-medium text-blue transition hover:bg-blue hover:text-white disabled:opacity-60">
                    {detail.loading ? "Cargando…" : "Cargar más"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
    </AppShell>
  );
}

// Modal no bloqueante: click en el backdrop (o Esc, manejado por el caller) cierra
// y regresa al reporte sin perder estado.
function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-dark-blue/80 p-4 sm:p-10"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-base font-semibold text-fg">{title}</h2>
          <button onClick={onClose}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-blue hover:text-blue">
            Cerrar
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}

// Tabla de agregados compacta: filas clickeables para el drill-down.
// heatCol: índice de la columna con mapa de calor (intensidad = r.heat
// relativo al máximo de la tabla).
function AggTable({ head, rows, empty, heatCol }: {
  head: string[];
  empty: string;
  heatCol?: number;
  rows: { key: string; cells: string[]; onClick?: () => void; mutedFirst?: boolean; heat?: number }[];
}) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
  const maxHeat = Math.max(...rows.map((r) => r.heat ?? 0));
  return (
    <div className="max-h-96 overflow-y-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={h} className={`pb-2 font-medium ${i >= head.length - 2 ? "text-right pl-3" : "pr-3"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}
                onClick={r.onClick}
                title={r.onClick ? "Ver registros" : undefined}
                className={`border-t border-border/60 ${r.onClick ? "cursor-pointer transition hover:bg-dark-blue/50" : ""}`}>
              {r.cells.map((c, i) => (
                <td key={i}
                    style={heatCol === i ? { backgroundColor: heatBg(r.heat ?? 0, maxHeat) } : undefined}
                    className={`py-2 ${i >= r.cells.length - 2
                      ? "text-right pl-3 tabular-nums whitespace-nowrap"
                      // [overflow-wrap:anywhere]: los códigos largos de subproyecto
                      // (SubProy-…::NO-3510) no tienen espacios y desbordaban la tarjeta.
                      : "pr-3 [overflow-wrap:anywhere]"}
                      ${heatCol === i ? "px-3" : ""}
                      ${i === 0 ? (r.mutedFirst ? "italic text-muted" : "text-fg") : i >= r.cells.length - 2 ? "text-fg" : "text-muted"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
