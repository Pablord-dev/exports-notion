"use client";
// Página principal de la BD: reportes (filtros combinables, evolución temporal,
// horas por persona y por subproyecto con drill-down) + exportación y
// sincronización en modals no bloqueantes (el viejo dashboard /db/tiempos se
// fusionó aquí; esa ruta ahora redirige). Datos: /api/reports/* y /api/sync/status.
// Diseño: el snapshot vive en el header como línea de estado; filtros en una
// toolbar de una fila; KPIs en una tira con divisores; las dos tablas en una
// tarjeta con tabs y barra de participación; el heat de la matriz en chips.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarRange, Download, RefreshCw, X } from "lucide-react";
import type { FlatRow } from "@/lib/types";
import { REPORT_PROPS, type PersonTotal, type SubprojectTotal, type TimelineBucket, type MatrixCell, type FilterOptions } from "@/lib/store-shared";
import { AppShell } from "@/app/components/app-shell";
import { AppModal } from "@/components/app-modal";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MultiSelect, Spinner, TimelineChart, fmtHours } from "./components";

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

// Chips del mapa de calor: fondo sky del brandbook (#02B5D3) con intensidad
// según el valor relativo al máximo de la tabla. Escala sqrt para que los
// valores medios no desaparezcan; el texto queda siempre sobre el chip, no
// sobre el fondo de la celda. Rampa 0.10 – 0.55.
const heatBg = (value: number, max: number): string | undefined =>
  max > 0 && value > 0 ? `rgba(2, 181, 211, ${(0.1 + 0.45 * Math.sqrt(value / max)).toFixed(3)})` : undefined;

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
  // null = ese kind no está croneado en vercel.json (sólo disparo manual).
  next: { incremental: string | null; full: string | null; };
  // Resueltos en el server contra la tabla `users`. La UI no ve roles.
  perms: { full: boolean; cancel: boolean };
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

/**
 * Botón vedado por rol.
 *
 * ⚠️ El atributo `disabled` NO sirve acá: un botón deshabilitado no emite eventos
 * de puntero, así que el tooltip de Radix nunca se abriría y el control quedaría
 * gris y mudo — justo lo que hay que evitar, porque el tooltip es la única
 * explicación de por qué no se puede. Con `aria-disabled` el botón sigue
 * anunciándose como deshabilitado, conserva el foco y se llega por teclado.
 */
function SinPermiso({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>Requiere permisos de administrador</TooltipContent>
    </Tooltip>
  );
}

// Cuenta regresiva autocontenida: su tick por segundo re-renderiza SOLO este
// span, no la página completa (el header la muestra siempre).
function Countdown({ iso }: { iso: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, []);
  return <span className="font-mono tabular-nums">{fmtCountdown(iso)}</span>;
}

// Etiqueta versalitas de tarjetas/estadísticas.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[10.5px] font-semibold uppercase tracking-widest text-subtle">{children}</p>;
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
  const [tableTab, setTableTab] = useState<"person" | "subproject">("person");
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
      // Deep-link desde el menú: ?modal=export abre el modal de exportación.
      // window.location en vez de useSearchParams: evita el boundary de
      // Suspense que Next exige para prerenderizar páginas cliente.
      if (new URLSearchParams(window.location.search).get("modal") === "export") setModal("export");
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

  const totals = useMemo(() => ({
    hours: byPerson.reduce((a, r) => a + r.hours, 0),
    count: byPerson.reduce((a, r) => a + r.count, 0),
    people: byPerson.length,
  }), [byPerson]);

  const hasFilters = Boolean(filters.from || filters.to || filters.people.length
    || filters.subprojects.length || filters.projects.length || filters.companies.length);
  const rangeLabel = filters.from && filters.to
    ? `${fmtDate(filters.from)} – ${fmtDate(filters.to)}`
    : filters.from
      ? `Desde ${fmtDate(filters.from)}`
      : filters.to
        ? `Hasta ${fmtDate(filters.to)}`
        : "Rango de fechas";

  if (authed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="text-sky" /><span className="text-sm">Cargando…</span>
      </main>
    );
  }
  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-foreground">Reportes</h1>
          <p className="text-sm text-muted-foreground">Necesitas iniciar sesión para consultar los reportes.</p>
          <Link href="/" className="inline-block rounded-lg bg-blue px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110">
            Ir al inicio de sesión
          </Link>
        </div>
      </main>
    );
  }

  const lastSync = syncStatus?.meta.lastIncrementalAt ?? syncStatus?.meta.lastFullAt ?? null;

  return (
    <AppShell onLogout={() => setAuthed(false)}
              tour={{ id: "reports", actions: {
                openExportModal: () => setModal("export"),
                openSyncModal: () => setModal("sync"),
                closeModal: () => setModal(null),
              } }}>
    <main className="mx-auto max-w-[75rem] space-y-6 px-6 py-7 sm:px-8">
      {/* Header: breadcrumb → título + línea de estado del snapshot → acciones */}
      <header className="space-y-3 border-b border-border pb-5">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link href="/">Menú</Link></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>BD Tiempos</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div data-tour="reports-snapshot">
            <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">BD Tiempos</h1>
            {running ? (
              <p className="mt-1.5 flex items-center gap-2 text-[12.5px] font-medium text-sky">
                <Spinner className="h-3 w-3" />
                Sincronizando ({syncStatus?.status.kind}): {syncStatus?.status.done} / {syncStatus?.status.total}
              </p>
            ) : (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-subtle">
                <span className="h-1.5 w-1.5 rounded-full bg-sky" aria-hidden />
                <span className="text-muted-foreground tabular-nums">
                  {(syncStatus?.meta.count ?? 0).toLocaleString("es-MX")} registros
                </span>
                <span>· sincronizado {fmtAgo(lastSync)}</span>
                {syncStatus?.next.incremental && (
                  <span>· próximo cron en <Countdown iso={syncStatus.next.incremental} /></span>
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2.5">
            <Button variant="outline" className="border-border-strong" onClick={() => setModal("export")}>
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
            <Button onClick={() => setModal("sync")}>
              <RefreshCw className="h-4 w-4" />
              Sincronizar
            </Button>
          </div>
        </div>
      </header>

      {/* Toolbar de filtros: rango como un solo control + 4 dimensiones + limpiar */}
      <section data-tour="reports-filters" className="rounded-xl border border-border bg-card p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline"
                      className={`font-normal ${filters.from || filters.to ? "border-border-strong bg-accent text-foreground" : "text-muted-foreground"}`}>
                <CalendarRange className="h-3.5 w-3.5" />
                {rangeLabel}
                {(filters.from || filters.to) && (
                  <span role="button" aria-label="Quitar rango de fechas"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setFilters({ ...filters, from: "", to: "" }); }}
                        className="ml-0.5 rounded-sm text-subtle transition hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
              <div className="flex gap-3">
                <Label className="flex-col items-start text-xs text-muted-foreground">Desde
                  <Input type="date" value={filters.from} max={filters.to}
                         onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
                </Label>
                <Label className="flex-col items-start text-xs text-muted-foreground">Hasta
                  <Input type="date" value={filters.to} min={filters.from}
                         onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
                </Label>
              </div>
            </PopoverContent>
          </Popover>
          <div className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />
          <MultiSelect label="Persona" options={options?.people ?? []} selected={filters.people}
                       onChange={(v) => setFilters({ ...filters, people: v })} />
          <MultiSelect label="Subproyecto" options={asOptions(options?.subprojects)} selected={filters.subprojects}
                       onChange={(v) => setFilters({ ...filters, subprojects: v })} />
          <MultiSelect label="Proyecto" options={asOptions(options?.projects)} selected={filters.projects}
                       onChange={(v) => setFilters({ ...filters, projects: v })} />
          <MultiSelect label="Empresa" options={asOptions(options?.companies)} selected={filters.companies}
                       onChange={(v) => setFilters({ ...filters, companies: v })} />
          {hasFilters && (
            <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground"
                    onClick={() => setFilters({ from: "", to: "", people: [], subprojects: [], projects: [], companies: [] })}>
              Limpiar
            </Button>
          )}
        </div>
        {!rangeValid && <p className="px-1 pt-2 text-sm font-medium text-danger">El rango es inválido: “Desde” es posterior a “Hasta”.</p>}
        {error && <p className="px-1 pt-2 text-sm font-medium text-danger">{error}</p>}
      </section>

      {/* Totales del corte: una tira con divisores, no tres tarjetas */}
      <section data-tour="reports-totals"
               className="grid grid-cols-1 rounded-xl border border-border bg-card sm:grid-cols-3 sm:divide-x divide-border max-sm:divide-y">
        {[
          {
            label: "Horas registradas", value: fmtHours(totals.hours), accent: true,
            sub: totals.people ? `promedio ${fmtHours(totals.hours / totals.people)} h por persona` : "sin personas en el corte",
          },
          {
            label: "Registros", value: totals.count.toLocaleString("es-MX"),
            sub: totals.count ? `${fmtHours(totals.hours / totals.count)} h por registro` : "sin registros en el corte",
          },
          {
            label: "Personas activas", value: String(totals.people),
            sub: "con registros en el corte",
          },
        ].map((t) => (
          <div key={t.label} className="px-5 py-4">
            <Eyebrow>{t.label}</Eyebrow>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-24" />
            ) : (
              <p className={`mt-2 font-display text-[32px] font-extrabold leading-none tracking-tight tabular-nums ${t.accent ? "text-sky" : "text-foreground"}`}>
                {t.value}
              </p>
            )}
            <p className="mt-1.5 text-[11.5px] text-subtle">{loading ? "…" : t.sub}</p>
          </div>
        ))}
      </section>

      {/* Evolución temporal */}
      <section data-tour="reports-timeline" className="rounded-xl border border-border bg-card p-5 pb-3 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-sans text-[15px] font-semibold text-foreground">Evolución de horas</h2>
            {!loading && timeline.length > 0 && (
              <span className="text-xs text-subtle">{fmtHours(totals.hours)} h en el corte</span>
            )}
          </div>
          <Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <TabsList>
              <TabsTrigger value="week">Semana</TabsTrigger>
              <TabsTrigger value="month">Mes</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {loading
          ? <div className="flex h-60 items-center justify-center text-muted-foreground"><Spinner className="text-sky" /></div>
          : <TimelineChart buckets={timeline} granularity={granularity}
                           onBarClick={(b) => { const r = barToRange(b); void openDetail(`Registros · ${fmtDate(r.from)} — ${fmtDate(r.to)}`, {}, r); }} />}
      </section>

      {/* Reporte dinámico: matriz dimensión × semana (1 persona o 1 subproyecto).
          El heat va en chips redondeados, no en el fondo de la celda. */}
      {matrixMode && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-medium tracking-wider text-sky">DINÁMICO</span>
              <h2 className="font-sans text-[15px] font-semibold text-foreground">{matrixMode.title}</h2>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-subtle">
              0 h
              <span className="h-1.5 w-16 rounded-full bg-gradient-to-r from-sky/10 to-sky" aria-hidden />
              máx
            </div>
          </div>
          {matrixLoading ? (
            <div className="flex h-44 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Spinner className="h-6 w-6 text-sky" />
              <p className="text-sm">Generando reporte…</p>
            </div>
          ) : !matrixView ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin registros en el rango seleccionado.</p>
          ) : (
            <Table className="text-left">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 h-auto bg-card pb-2.5 pl-5 pr-3 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">{matrixMode.rowLabel}</TableHead>
                  {matrixView.weeks.map((w) => (
                    <TableHead key={w} className="h-auto whitespace-nowrap px-2 pb-2.5 text-right font-mono text-[10.5px] font-semibold text-subtle">{fmtWeek(w)}</TableHead>
                  ))}
                  <TableHead className="h-auto pb-2.5 pl-3 pr-5 text-right text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrixView.rows.map((r) => (
                  <TableRow key={r.group ?? "__sin_grupo__"} className="border-border/60">
                    <TableCell className={`sticky left-0 min-w-44 max-w-72 bg-card py-2 pl-5 pr-3 whitespace-normal text-[13px] [overflow-wrap:anywhere] ${r.group ? "text-foreground" : "italic text-muted-foreground"}`}>
                      {/* grupo sin valor: nunca mostrar el label (mezclaría personas) */}
                      {r.group ? (r.label ?? r.group) : matrixMode.nullLabel}
                    </TableCell>
                    {matrixView.weeks.map((w) => {
                      const v = r.cells.get(w);
                      return (
                        <TableCell key={w} className="px-1.5 py-1.5 text-right">
                          {v ? (
                            <span className="inline-block min-w-14 rounded-md px-2 py-1 text-right font-mono text-[12.5px] tabular-nums text-foreground"
                                  style={{ backgroundColor: heatBg(v, matrixView.max) }}>
                              {fmtHours(v)}
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-1 font-mono text-[12.5px] text-subtle/60">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="whitespace-nowrap py-1.5 pl-3 pr-5 text-right font-mono text-[13.5px] font-medium tabular-nums text-sky">{fmtHours(r.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {/* Distribución de horas: una tarjeta con tabs (persona / subproyecto) */}
      <section data-tour="reports-tables" className="overflow-hidden rounded-xl border border-border bg-card">
        <Tabs value={tableTab} onValueChange={(v) => setTableTab(v as "person" | "subproject")}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
            <h2 className="font-sans text-[15px] font-semibold text-foreground">Distribución de horas</h2>
            <TabsList>
              <TabsTrigger value="person">Por persona</TabsTrigger>
              <TabsTrigger value="subproject">Por subproyecto</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="person">
            <AggTable
              nameLabel="Persona"
              unit="personas"
              empty={loading ? "Cargando…" : "Sin registros en el rango."}
              rows={byPerson.map((r) => {
                // Con ID muestra el nombre (o el ID si el grupo no trae nombre). El grupo
                // SIN relación junta a muchas personas: siempre "(sin persona)", nunca
                // el max() del nombre (etiquetaría a una persona arbitraria).
                const name = r.person ? (r.label ?? r.person) : "(sin persona)";
                return {
                  key: r.person || "(sin persona)",
                  name,
                  // sin relación no hay valor por el cual filtrar el detalle
                  onClick: r.person ? () => void openDetail(`Registros · ${name}`, { person: r.person }) : undefined,
                  hours: r.hours,
                  count: r.count,
                  muted: !r.person,
                };
              })} />
          </TabsContent>
          <TabsContent value="subproject">
            <AggTable
              nameLabel="Subproyecto"
              unit="subproyectos"
              showProject
              empty={loading ? "Cargando…" : "Sin registros en el rango."}
              rows={bySubproject.map((r) => ({
                key: r.subproject ?? "(sin subproyecto)",
                name: r.subproject ?? "(sin subproyecto)",
                project: r.project ?? undefined,
                // los registros sin subproyecto no tienen valor por el cual filtrar el detalle
                onClick: r.subproject ? () => void openDetail(`Registros · ${r.subproject}`, { subproject: r.subproject! }) : undefined,
                hours: r.hours,
                count: r.count,
                muted: !r.subproject,
              }))} />
          </TabsContent>
        </Tabs>
      </section>

      {/* Modal de exportación (no bloqueante: click fuera o Esc regresa al reporte) */}
      <AppModal open={modal === "export"} onClose={() => setModal(null)} title="Exportar CSV" anchor="export-modal">
        <p className="text-sm text-muted-foreground">
          Rango opcional por fecha de creación. Con ambos campos vacíos se exporta todo el snapshot.
        </p>
        <div className="flex gap-3">
          <Label className="flex-1 flex-col items-start text-sm text-muted-foreground">Desde
            <Input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
          </Label>
          <Label className="flex-1 flex-col items-start text-sm text-muted-foreground">Hasta
            <Input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
          </Label>
        </div>
        <Button onClick={download} disabled={downloading} className="w-fit">
          {downloading && <Spinner className="h-3.5 w-3.5" />}
          {downloading ? "Descargando…" : "Descargar"}
        </Button>
        {downloadErr && <p className="text-sm font-medium text-danger">{downloadErr}</p>}
      </AppModal>

      {/* Modal de sincronización (no bloqueante) */}
      <AppModal open={modal === "sync"} onClose={() => setModal(null)} title="Sincronización" anchor="sync-modal">
        {/* Tira de estado hundida: registros + últimas corridas */}
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-background">
          <div className="px-4 py-3.5">
            <Eyebrow>Registros</Eyebrow>
            <p className="mt-1.5 font-display text-[22px] font-extrabold leading-none tracking-tight text-sky tabular-nums">
              {(syncStatus?.meta.count ?? 0).toLocaleString("es-MX")}
            </p>
          </div>
          <div className="px-4 py-3.5">
            <Eyebrow>Incremental</Eyebrow>
            <p className="mt-1.5 text-sm font-medium text-foreground">{fmtAgo(syncStatus?.meta.lastIncrementalAt ?? null)}</p>
          </div>
          <div className="px-4 py-3.5">
            <Eyebrow>Full</Eyebrow>
            <p className="mt-1.5 text-sm font-medium text-foreground">{fmtAgo(syncStatus?.meta.lastFullAt ?? null)}</p>
          </div>
        </div>
        {syncStatus?.status.lastResult && (
          <p className="text-sm text-muted-foreground">
            Último sync <span className="text-subtle">({syncStatus.status.lastResult.kind}, {fmtAgo(syncStatus.status.lastResult.finishedAt)})</span>:{" "}
            <span className="font-medium text-foreground">{syncStatus.status.lastResult.upserted} actualizados</span>
            {" · "}
            <span className="font-medium text-foreground">{syncStatus.status.lastResult.deleted} eliminados</span>
            {syncStatus.status.lastResult.skipped ? (
              <> · <span className="font-medium text-warning">{syncStatus.status.lastResult.skipped} omitidos</span></>
            ) : null}
          </p>
        )}
        <Separator />
        {running ? (
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 font-sans text-sm font-semibold text-foreground">
              <Spinner className="text-sky" />
              Sync en progreso <span className="font-normal text-muted-foreground">({syncStatus?.status.kind})</span>
            </h3>
            {/* Sin denominador a propósito: Notion no expone un total de antemano, así
                que `status.total` es sólo done + un page_size cuando queda más. Mostrarlo
                como "1,200 / 1,300" fingía un progreso que nadie conoce. */}
            <p className="font-display text-xl font-bold text-foreground">
              {(syncStatus?.status.done ?? 0).toLocaleString("es-MX")}
              <span className="ml-1.5 font-sans text-sm font-normal text-muted-foreground">
                {(syncStatus?.status.total ?? 0) > (syncStatus?.status.done ?? 0) ? "registros y contando…" : "registros"}
              </span>
            </p>
            {syncStatus?.status.skipped ? <p className="text-sm font-medium text-warning">Omitidos: {syncStatus.status.skipped}</p> : null}
            {syncStatus?.perms.cancel === false ? (
              <SinPermiso>
                <Button variant="outline" aria-disabled className="border-danger text-danger opacity-50">
                  Cancelar y guardar lo cargado
                </Button>
              </SinPermiso>
            ) : (
              <Button variant="outline" onClick={cancelSync} disabled={cancelling}
                      className="border-danger text-danger hover:bg-danger hover:text-white">
                {cancelling && <Spinner className="h-3.5 w-3.5" />}
                {cancelling ? "Cancelando…" : "Cancelar y guardar lo cargado"}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-8">
              <div>
                <Eyebrow>Próximo incremental</Eyebrow>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {syncStatus?.next.incremental ? <Countdown iso={syncStatus.next.incremental} /> : "—"}
                </p>
              </div>
              <div>
                <Eyebrow>Full</Eyebrow>
                <p className="mt-1 text-sm font-medium text-muted-foreground">
                  {syncStatus?.next.full ? <>en <Countdown iso={syncStatus.next.full} /></> : "sólo manual"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button onClick={() => trigger("incremental")} disabled={triggering !== null}>
                {triggering === "incremental" ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-4 w-4" />}
                {triggering === "incremental" ? "Iniciando…" : "Refrescar incremental"}
              </Button>
              {syncStatus?.perms.full === false ? (
                <SinPermiso>
                  <Button variant="outline" aria-disabled className="border-border opacity-50">
                    Full
                  </Button>
                </SinPermiso>
              ) : (
                <Button variant="outline" className="border-border-strong" onClick={() => trigger("full")} disabled={triggering !== null}>
                  {triggering === "full" && <Spinner className="h-3.5 w-3.5" />}
                  {triggering === "full" ? "Iniciando…" : "Full"}
                </Button>
              )}
              <span className="ml-auto text-[11.5px] text-subtle">El full puede tardar varios minutos</span>
            </div>
          </div>
        )}
      </AppModal>

      {/* Panel de detalle (drill-down) */}
      {detail && (
        <AppModal open onClose={() => setDetail(null)} title={detail.title} wide>
          {detail.loading && detail.rows.length === 0
            ? <div className="flex justify-center py-10"><Spinner className="text-sky" /></div>
            : detail.rows.length === 0
              ? <p className="py-8 text-center text-sm text-muted-foreground">Sin registros para este corte.</p>
              : (
                <Table className="text-left">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-auto px-0 pb-2.5 pr-3 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">ID</TableHead>
                      <TableHead className="h-auto px-0 pb-2.5 pr-3 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Fecha</TableHead>
                      <TableHead className="h-auto px-0 pb-2.5 pr-3 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Persona</TableHead>
                      <TableHead className="h-auto px-0 pb-2.5 pr-3 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Tarea</TableHead>
                      <TableHead className="h-auto px-0 pb-2.5 pr-3 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Descripción</TableHead>
                      <TableHead className="h-auto px-0 pb-2.5 text-right text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Horas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.rows.map((r) => (
                      <TableRow key={r["ID"]} className="border-border/60">
                        <TableCell className="p-0 py-2 pr-3 align-top whitespace-nowrap font-mono text-xs text-subtle">{r["ID"]}</TableCell>
                        <TableCell className="p-0 py-2 pr-3 align-top whitespace-nowrap text-foreground">{fmtDate(r["Hora de creación"])}</TableCell>
                        {/* La columna "Persona" muestra el nombre (personLabel), no el ID de la relación */}
                        <TableCell className="p-0 py-2 pr-3 align-top whitespace-normal text-foreground">{r[REPORT_PROPS.personLabel]}</TableCell>
                        <TableCell className="p-0 py-2 pr-3 align-top whitespace-normal text-foreground">{r["Tarea"]}</TableCell>
                        <TableCell className="p-0 py-2 pr-3 align-top whitespace-normal text-muted-foreground">{r["Breve descripción"]}</TableCell>
                        <TableCell className="p-0 py-2 text-right align-top font-mono font-medium text-sky whitespace-nowrap tabular-nums">{fmtHours(Number(r["Registro de horas"]) || 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
          {detail.nextCursor && (
            <div className="pt-2 text-center">
              <Button variant="outline" disabled={detail.loading}
                      onClick={() => { setDetail({ ...detail, loading: true }); void loadDetailPage({ ...detail, loading: true }); }}>
                {detail.loading ? "Cargando…" : "Cargar más"}
              </Button>
            </div>
          )}
        </AppModal>
      )}
    </main>
    </AppShell>
  );
}

// Tabla de agregados: ranking con barra de participación (el heat sale del
// fondo de la celda: texto siempre sobre la misma superficie). Top-10 por
// default con footer "N de M · Ver todas"; filas clickeables para drill-down.
function AggTable({ nameLabel, unit, rows, empty, showProject }: {
  nameLabel: string;
  unit: string;
  empty: string;
  showProject?: boolean;
  rows: { key: string; name: string; project?: string; hours: number; count: number; onClick?: () => void; muted?: boolean }[];
}) {
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  const maxHours = Math.max(...rows.map((r) => r.hours));
  const totalHours = rows.reduce((a, r) => a + r.hours, 0);
  const visible = showAll ? rows : rows.slice(0, 10);
  const headCls = "h-auto pb-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-subtle";
  return (
    <>
      <div className={showAll ? "max-h-[560px] overflow-y-auto" : undefined}>
        <Table className="text-left">
          <TableHeader className="sticky top-0 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className={`${headCls} w-11 pl-5 pr-0`}>#</TableHead>
              <TableHead className={`${headCls} pr-3`}>{nameLabel}</TableHead>
              {showProject && <TableHead className={`${headCls} pr-3`}>Proyecto</TableHead>}
              <TableHead className={`${headCls} w-52 pr-3 max-md:hidden`}>Distribución</TableHead>
              <TableHead className={`${headCls} w-24 pr-3 text-right`}>Horas</TableHead>
              <TableHead className={`${headCls} w-16 pr-3 text-right max-sm:hidden`}>Part.</TableHead>
              <TableHead className={`${headCls} w-24 pr-5 text-right`}>Registros</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r, i) => (
              <TableRow key={r.key}
                  onClick={r.onClick}
                  title={r.onClick ? "Ver registros" : undefined}
                  className={`border-border/60 ${r.onClick ? "cursor-pointer transition hover:bg-accent/40" : ""}`}>
                <TableCell className="h-10 py-0 pl-5 pr-0 font-mono text-[11px] text-subtle tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </TableCell>
                {/* [overflow-wrap:anywhere]: los códigos largos de subproyecto
                    (SubProy-…::NO-3510) no tienen espacios y desbordaban la tarjeta. */}
                <TableCell className={`h-10 py-1.5 pr-3 text-[13px] whitespace-normal [overflow-wrap:anywhere] ${r.muted ? "italic text-muted-foreground" : "text-foreground"}`}>
                  {r.name}
                </TableCell>
                {showProject && (
                  <TableCell className="h-10 py-1.5 pr-3 text-[13px] whitespace-normal [overflow-wrap:anywhere] text-muted-foreground">
                    {r.project ?? "—"}
                  </TableCell>
                )}
                <TableCell className="h-10 py-0 pr-3 max-md:hidden">
                  <div className="h-1.5 rounded-full bg-accent">
                    <div className="h-1.5 rounded-full bg-sky"
                         style={{ width: `${maxHours > 0 ? Math.max((r.hours / maxHours) * 100, 1) : 0}%` }} />
                  </div>
                </TableCell>
                <TableCell className="h-10 py-0 pr-3 text-right font-mono text-[13.5px] font-medium tabular-nums text-sky whitespace-nowrap">
                  {fmtHours(r.hours)}
                </TableCell>
                <TableCell className="h-10 py-0 pr-3 text-right font-mono text-xs tabular-nums text-subtle whitespace-nowrap max-sm:hidden">
                  {totalHours > 0 ? `${((r.hours / totalHours) * 100).toFixed(1)}%` : "—"}
                </TableCell>
                <TableCell className="h-10 py-0 pr-5 text-right font-mono text-[13px] tabular-nums text-muted-foreground whitespace-nowrap">
                  {r.count.toLocaleString("es-MX")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between border-t border-border bg-background px-5 py-2.5">
        <span className="text-[11.5px] text-subtle">
          {visible.length} de {rows.length} {unit} · click en una fila para ver sus registros
        </span>
        {rows.length > 10 && (
          <button onClick={() => setShowAll(!showAll)}
                  className="text-xs font-medium text-link transition hover:brightness-110">
            {showAll ? "Ver menos" : "Ver todas"}
          </button>
        )}
      </div>
    </>
  );
}
