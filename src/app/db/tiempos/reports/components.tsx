"use client";
// Piezas de la página de reportes. Tema dark fijo del brandbook iU:
// serie de datos en sky (#02B5D3 — validado 3:1+ sobre surface); blue queda
// reservado a acciones. Texto siempre en tokens de texto, nunca en el color
// de la serie.
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
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
// TimelineChart: una sola serie (horas por periodo) con Recharts vía el
// wrapper Chart de shadcn. Barras sky, grid recesivo, tooltip al hover y
// click para abrir el detalle del periodo.
// ---------------------------------------------------------------------------
function bucketLabel(iso: string, granularity: "month" | "week"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (granularity === "month") {
    return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: "UTC" });
}

const chartConfig = {
  hours: { label: "Horas", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function TimelineChart({ buckets, granularity, onBarClick }: {
  buckets: TimelineBucket[];
  granularity: "month" | "week";
  onBarClick?: (bucket: string) => void;
}) {
  if (!buckets.length) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Sin registros en el rango seleccionado.</p>;
  }
  // etiquetas X: máx ~12 para no encimar (mismo criterio del SVG previo)
  const every = Math.ceil(buckets.length / 12);
  return (
    <ChartContainer config={chartConfig} className="h-60 w-full"
                    aria-label={`Horas por ${granularity === "month" ? "mes" : "semana"}`}>
      <BarChart data={buckets} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={10}
               interval={every - 1} tickFormatter={(v: string) => bucketLabel(v, granularity)} />
        <YAxis tickLine={false} axisLine={false} width={46} fontSize={10}
               tickFormatter={(v: number) => fmtHours(v)} />
        <ChartTooltip cursor={{ fill: "var(--border)", opacity: 0.35 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as TimelineBucket;
            return (
              <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl">
                <p className="font-medium text-foreground">{bucketLabel(d.bucket, granularity)}</p>
                <p className="font-semibold text-sky">{fmtHours(d.hours)} h</p>
                <p className="text-muted-foreground">{d.count} registros</p>
                {onBarClick && <p className="mt-1 text-muted-foreground">Click para ver el detalle</p>}
              </div>
            );
          }} />
        <Bar dataKey="hours" fill="var(--color-hours)" radius={[4, 4, 0, 0]} maxBarSize={48}
             className={onBarClick ? "cursor-pointer" : undefined}
             onClick={(data: unknown) => {
               const bucket = (data as { bucket?: string })?.bucket;
               if (bucket) onBarClick?.(bucket);
             }} />
      </BarChart>
    </ChartContainer>
  );
}
