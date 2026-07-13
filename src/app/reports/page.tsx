"use client";
// Página de reportes (SB-13): filtros combinables, evolución temporal,
// horas por persona y por subproyecto con drill-down al detalle.
// Todos los datos salen de /api/reports/* (SQL sobre el snapshot).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FlatRow } from "@/lib/types";
import type { PersonTotal, SubprojectTotal, TimelineBucket, FilterOptions } from "@/lib/store-shared";
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

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = () => `${new Date().toISOString().slice(0, 7)}-01`;

function filterParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams({ from: f.from, to: f.to });
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

export default function Reports() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<Filters>({
    from: monthStartISO(), to: todayISO(),
    people: [], subprojects: [], projects: [], companies: [],
  });
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [byPerson, setByPerson] = useState<PersonTotal[]>([]);
  const [bySubproject, setBySubproject] = useState<SubprojectTotal[]>([]);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

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

  const rangeValid = filters.from <= filters.to;

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
    // acotado al rango vigente para no salirse del filtro
    const from = bucket < filters.from ? filters.from : bucket;
    const toISO = end.toISOString().slice(0, 10);
    return { from, to: toISO > filters.to ? filters.to : toISO };
  }

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetail(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail]);

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
    <main className="max-w-5xl mx-auto p-6 sm:p-8 space-y-6">
      <header className="flex items-center justify-between border-b border-border pb-5">
        <div className="flex items-baseline gap-4">
          <h1 className="font-display text-xl font-bold text-fg tracking-tight">Reportes</h1>
          <span className="text-sm text-muted">{fmtDate(filters.from)} — {fmtDate(filters.to)}</span>
        </div>
        <Link href="/" className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-blue hover:text-blue">
          ← Exportar CSV
        </Link>
      </header>

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
          <div className="pt-6"><MultiSelect label="Subproyecto" options={options?.subprojects ?? []} selected={filters.subprojects}
                                             onChange={(v) => setFilters({ ...filters, subprojects: v })} /></div>
          <div className="pt-6"><MultiSelect label="Proyecto" options={options?.projects ?? []} selected={filters.projects}
                                             onChange={(v) => setFilters({ ...filters, projects: v })} /></div>
          <div className="pt-6"><MultiSelect label="Empresa" options={options?.companies ?? []} selected={filters.companies}
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

      {/* Tablas de agregados */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-fg">Horas por persona</h2>
          <AggTable
            head={["Persona", "Horas", "Registros"]}
            empty={loading ? "Cargando…" : "Sin registros en el rango."}
            rows={byPerson.map((r) => ({
              key: r.person,
              onClick: () => void openDetail(`Registros · ${r.person}`, { person: r.person }),
              cells: [r.person, fmtHours(r.hours), String(r.count)],
            }))} />
        </section>
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-fg">Horas por subproyecto</h2>
          <AggTable
            head={["Subproyecto", "Proyecto", "Horas", "Registros"]}
            empty={loading ? "Cargando…" : "Sin registros en el rango."}
            rows={bySubproject.map((r) => ({
              key: r.subproject ?? "(sin subproyecto)",
              // los registros sin subproyecto no tienen valor por el cual filtrar el detalle
              onClick: r.subproject ? () => void openDetail(`Registros · ${r.subproject}`, { subproject: r.subproject! }) : undefined,
              cells: [r.subproject ?? "(sin subproyecto)", r.project ?? "—", fmtHours(r.hours), String(r.count)],
              mutedFirst: !r.subproject,
            }))} />
        </section>
      </div>

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
                            <td className="py-2 pr-3 text-fg">{r["Persona"]}</td>
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
  );
}

// Tabla de agregados compacta: filas clickeables para el drill-down.
function AggTable({ head, rows, empty }: {
  head: string[];
  empty: string;
  rows: { key: string; cells: string[]; onClick?: () => void; mutedFirst?: boolean }[];
}) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
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
                    className={`py-2 ${i >= r.cells.length - 2
                      ? "text-right pl-3 tabular-nums whitespace-nowrap"
                      // [overflow-wrap:anywhere]: los códigos largos de subproyecto
                      // (SubProy-…::NO-3510) no tienen espacios y desbordaban la tarjeta.
                      : "pr-3 [overflow-wrap:anywhere]"}
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
