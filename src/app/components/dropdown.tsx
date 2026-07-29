"use client";
// Dropdown propio (no <select> nativo) para poder redondear/estilizar el menú
// de opciones con el brandbook. Abre hacia arriba (vive al fondo del composer).
import { useEffect, useRef, useState } from "react";

export interface DropdownOption { value: string; label: string }

export function Dropdown({ value, options, onChange, disabled, ariaLabel, openUp = false }: {
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  openUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "—";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition hover:border-blue disabled:cursor-not-allowed disabled:opacity-60">
        <span className="max-w-[11rem] truncate">{current}</span>
        <svg className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul role="listbox" aria-label={ariaLabel}
            className={`absolute left-0 z-40 max-h-60 min-w-full overflow-auto rounded-xl border border-border bg-card p-1 shadow-xl ${openUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition ${
                  o.value === value ? "bg-blue text-white" : "text-foreground hover:bg-background"
                }`}>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
