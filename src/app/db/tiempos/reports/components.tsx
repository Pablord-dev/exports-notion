"use client";
// Piezas de la página de reportes. Tema dark fijo del brandbook iU:
// serie de datos en sky (#02B5D3 — validado 3:1+ sobre surface); blue queda
// reservado a acciones. Texto siempre en tokens de texto, nunca en el color
// de la serie.
import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TimelineBucket } from "@/lib/store-shared";

export { Spinner } from "@/app/components/spinner";

export const fmtHours = (h: number) =>
  h.toLocaleString("es-MX", { maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// MultiSelect: Popover + Command con búsqueda y toggle por item. El botón
// muestra cuántos hay seleccionados. Las opciones son pares {value, label}:
// se busca/muestra por label, se selecciona por value (para Persona:
// value = ID de la relación, label = nombre).
// ---------------------------------------------------------------------------
export interface MultiSelectOption { value: string; label: string; }

export function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline"
                className={`w-full justify-between px-3 font-normal ${selected.length ? "border-sky/60" : "text-muted-foreground"}`}>
          <span className="truncate">{label}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {selected.length > 0 && (
              <Badge variant="secondary" className="rounded-full px-1.5 font-medium text-sky">{selected.length}</Badge>
            )}
            <ChevronsUpDown className="h-3 w-3 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Buscar…" />
          <CommandList>
            <CommandEmpty>Sin coincidencias</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                  <Check className={`h-4 w-4 text-sky ${selected.includes(o.value) ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t border-border p-1">
              <Button variant="ghost" size="sm" onClick={() => onChange([])}
                      className="w-full justify-start font-normal text-muted-foreground">
                Limpiar selección
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
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
    return <p className="py-12 text-center text-sm text-muted-foreground">Sin registros en el rango seleccionado.</p>;
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
        <div className="pointer-events-none absolute rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl"
             style={{
               left: `${((PAD_L + step * hover + step / 2) / W) * 100}%`,
               top: 0,
               transform: `translateX(${hover > buckets.length / 2 ? "-100%" : "0"})`,
             }}>
          <p className="font-medium text-foreground">{bucketLabel(buckets[hover].bucket, granularity)}</p>
          <p className="text-sky font-semibold">{fmtHours(buckets[hover].hours)} h</p>
          <p className="text-muted-foreground">{buckets[hover].count} registros</p>
          {onBarClick && <p className="mt-1 text-muted-foreground">Click para ver el detalle</p>}
        </div>
      )}
    </div>
  );
}
