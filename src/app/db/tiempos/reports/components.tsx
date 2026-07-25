"use client";
// Piezas de la página de reportes. Tema dark fijo del brandbook iU:
// serie de datos en sky (#02B5D3 — validado 3:1+ sobre surface); blue queda
// reservado a acciones. Texto siempre en tokens de texto, nunca en el color
// de la serie.
import { useEffect, useRef, useState } from "react";
import type { TimelineBucket } from "@/lib/store-shared";

export { Spinner } from "@/app/components/spinner";

export const fmtHours = (h: number) =>
  h.toLocaleString("es-MX", { maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// MultiSelect: botón + dropdown con búsqueda y checkboxes. Cierra con click
// afuera o Esc. El valor muestra cuántos hay seleccionados. Las opciones son
// pares {value, label}: se busca/muestra por label, se selecciona por value
// (para Persona: value = ID de la relación, label = nombre).
// ---------------------------------------------------------------------------
export interface MultiSelectOption { value: string; label: string; }

export function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const visible = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div ref={ref} className="relative text-sm">
      <button type="button" onClick={() => { setOpen(!open); setQuery(""); }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition
                ${selected.length ? "border-sky/60 text-fg" : "border-border text-muted"} hover:border-blue focus-visible:ring-2 focus-visible:ring-blue/30 outline-none`}>
        <span className="truncate">
          {label}{selected.length ? <span className="ml-1.5 font-medium text-sky">{selected.length}</span> : ""}
        </span>
        <svg className={`h-3 w-3 shrink-0 transition ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-56 rounded-lg border border-border bg-surface shadow-xl shadow-dark-blue/60">
          <div className="p-2 border-b border-border">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" autoFocus
                   className="w-full rounded-md border border-border bg-dark-blue px-2 py-1.5 text-fg placeholder:text-muted outline-none focus:border-blue" />
          </div>
          <ul className="max-h-56 overflow-y-auto p-1">
            {visible.length === 0 && <li className="px-2 py-2 text-muted">Sin coincidencias</li>}
            {visible.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-dark-blue">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)}
                         className="accent-[#0f40ef]" />
                  <span className="truncate text-fg">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <div className="border-t border-border p-1">
              <button type="button" onClick={() => onChange([])}
                      className="w-full rounded-md px-2 py-1.5 text-left text-muted transition hover:bg-dark-blue hover:text-fg">
                Limpiar selección
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BarChart: una sola serie (horas por periodo), SVG responsivo. Barras sky con
// remate superior redondeado anclado a la línea base, grid recesivo, tooltip
// al hover y click para abrir el detalle del periodo.
// ---------------------------------------------------------------------------
const W = 920, H = 240, PAD_L = 46, PAD_R = 8, PAD_T = 14, PAD_B = 30;

function bucketLabel(iso: string, granularity: "month" | "week"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (granularity === "month") {
    return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function BarChart({ buckets, granularity, onBarClick }: {
  buckets: TimelineBucket[];
  granularity: "month" | "week";
  onBarClick?: (bucket: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!buckets.length) {
    return <p className="py-12 text-center text-sm text-muted">Sin registros en el rango seleccionado.</p>;
  }
  const max = Math.max(...buckets.map((b) => b.hours), 1);
  // techo "bonito" para el eje: 1-2-5 × 10^n
  const pow = 10 ** Math.floor(Math.log10(max));
  const niceMax = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= max) ?? max;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const step = innerW / buckets.length;
  const barW = Math.min(Math.max(step * 0.6, 3), 48);
  const y = (v: number) => PAD_T + innerH * (1 - v / niceMax);
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => niceMax * f);
  // etiquetas X: máx ~12 para no encimar
  const every = Math.ceil(buckets.length / 12);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label={`Horas por ${granularity === "month" ? "mes" : "semana"}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="#1c3c84" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#9a9a9a">{fmtHours(t)}</text>
          </g>
        ))}
        <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke="#1c3c84" strokeWidth="1.5" />
        {buckets.map((b, i) => {
          const cx = PAD_L + step * i + step / 2;
          const x0 = cx - barW / 2, yTop = y(b.hours), h = y(0) - yTop;
          const r = Math.min(4, barW / 2, h); // remate redondeado sólo arriba
          return (
            <g key={b.bucket}
               className={onBarClick ? "cursor-pointer" : undefined}
               onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
               onClick={() => onBarClick?.(b.bucket)}>
              {/* hit target más ancho que la barra */}
              <rect x={PAD_L + step * i} y={PAD_T} width={step} height={innerH} fill="transparent" />
              <path d={`M${x0} ${y(0)} V${yTop + r} Q${x0} ${yTop} ${x0 + r} ${yTop} H${x0 + barW - r} Q${x0 + barW} ${yTop} ${x0 + barW} ${yTop + r} V${y(0)} Z`}
                    fill="#02b5d3" opacity={hover === null || hover === i ? 1 : 0.45}
                    style={{ transition: "opacity 120ms" }} />
              {i % every === 0 && (
                <text x={cx} y={H - 10} textAnchor="middle" fontSize="10" fill="#9a9a9a">
                  {bucketLabel(b.bucket, granularity)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && buckets[hover] && (
        <div className="pointer-events-none absolute rounded-lg border border-border bg-dark-blue px-3 py-2 text-xs shadow-xl"
             style={{
               left: `${((PAD_L + step * hover + step / 2) / W) * 100}%`,
               top: 0,
               transform: `translateX(${hover > buckets.length / 2 ? "-100%" : "0"})`,
             }}>
          <p className="font-medium text-fg">{bucketLabel(buckets[hover].bucket, granularity)}</p>
          <p className="text-sky font-semibold">{fmtHours(buckets[hover].hours)} h</p>
          <p className="text-muted">{buckets[hover].count} registros</p>
          {onBarClick && <p className="mt-1 text-muted">Click para ver el detalle</p>}
        </div>
      )}
    </div>
  );
}
