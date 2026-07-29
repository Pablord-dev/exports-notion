"use client";
// Dos formas de ofrecer el recorrido tras iniciar sesión:
// - Modal: sólo el primer login de este navegador (ahí sí interrumpe).
// - Tira: en los siguientes. Siempre hay una vía visible, sin estorbar.
import { useEffect, useRef } from "react";

export function WelcomeModal({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  const startRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { startRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Trampa de Tab: mantiene el foco dentro del modal (mismo patrón que
  // TourPopover). Sin ella, Tab escapa al backdrop y llega a elementos
  // enfocables tapados por él (el botón "?", los enlaces del menú de atrás).
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

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-background/80 p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}>
      <div ref={boxRef} onKeyDown={onKeyDown}
           role="dialog" aria-modal="true" aria-labelledby="welcome-title" data-testid="welcome-modal"
           className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h2 id="welcome-title" className="font-display text-xl font-bold text-foreground">
          Bienvenido a ExportNotion
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          ¿Te muestro cómo funciona? Son cinco pasos y toma menos de un minuto. Puedes salir cuando
          quieras y retomarlo con el botón “?” de cualquier pantalla.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onDismiss}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:border-blue hover:text-blue">
            Ahora no
          </button>
          <button ref={startRef} onClick={onStart}
                  className="rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white transition hover:brightness-110">
            Empezar
          </button>
        </div>
      </div>
    </div>
  );
}

export function WelcomeBanner({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div data-testid="welcome-banner"
         className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 text-sm sm:px-5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-sky" aria-hidden />
      <p className="min-w-0 flex-1 text-muted-foreground">
        ¿Nuevo por aquí?{" "}
        <button onClick={onStart} className="font-medium text-sky underline-offset-2 transition hover:underline">
          Iniciar tutorial
        </button>
      </p>
      <button onClick={onDismiss} aria-label="Ocultar el aviso del tutorial"
              className="shrink-0 rounded p-1 text-muted-foreground transition hover:text-foreground">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
