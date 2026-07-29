"use client";
// Globo del recorrido guiado. Presentacional: la posición ya viene calculada
// por popoverPlacement(). Al montar y en cada cambio de paso el foco va al
// botón principal, y Tab circula sólo entre los botones del globo (mientras el
// tour está activo el resto de la página está bloqueada por el overlay).
import { useEffect, useRef } from "react";
import { POPOVER_W, type Placement } from "@/lib/tour/geometry";

export interface TourPopoverProps {
  title: string;
  body: string;
  /** Índice 0-based del paso vigente. */
  index: number;
  total: number;
  placement: Placement;
  /** "Siguiente", "Terminar" o la etiqueta del encadenado. */
  nextLabel: string;
  onNext: () => void;
  /** Ausente en el primer paso. */
  onPrev?: () => void;
  onSkip: () => void;
}

export function TourPopover({
  title, body, index, total, placement, nextLabel, onNext, onPrev, onSkip,
}: TourPopoverProps) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // El foco sigue al paso: quien navega con teclado no pierde el hilo.
  useEffect(() => { nextRef.current?.focus(); }, [index]);

  // Trampa de Tab: mantiene el foco dentro del globo.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !boxRef.current) return;
    const focusables = boxRef.current.querySelectorAll<HTMLElement>("button");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  const style: React.CSSProperties = placement.mobile
    ? { top: placement.top }
    : { top: placement.top, left: placement.left, width: POPOVER_W };

  return (
    <div
      ref={boxRef}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      data-testid="tour-popover"
      data-tour-step={index}
      style={style}
      className={`fixed z-[57] space-y-3 rounded-2xl border border-sky/40 bg-surface p-5 shadow-2xl ${
        placement.mobile ? "left-2 right-2" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="tour-title" className="font-display text-base font-bold text-fg">{title}</h2>
        <button onClick={onSkip} aria-label="Cerrar el recorrido"
                className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-muted transition hover:text-danger">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <p className="text-sm leading-relaxed text-muted">{body}</p>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-xs tabular-nums text-muted" data-testid="tour-progress">
          {index + 1} / {total}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={onSkip}
                  className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition hover:text-fg">
            Saltar
          </button>
          {onPrev && (
            <button onClick={onPrev}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-blue hover:text-blue">
              Atrás
            </button>
          )}
          <button ref={nextRef} onClick={onNext}
                  className="rounded-lg bg-blue px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110">
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
