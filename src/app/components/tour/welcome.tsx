"use client";
// Dos formas de ofrecer el recorrido tras iniciar sesión:
// - Modal: sólo el primer login de este navegador (ahí sí interrumpe).
// - Tira: en los siguientes. Siempre hay una vía visible, sin estorbar.
import { useEffect, useRef } from "react";

export function WelcomeModal({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { startRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-dark-blue/80 p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" data-testid="welcome-modal"
           className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <h2 id="welcome-title" className="font-display text-xl font-bold text-fg">
          Bienvenido a ExportNotion
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          ¿Te muestro cómo funciona? Son cinco pasos y toma menos de un minuto. Puedes salir cuando
          quieras y retomarlo con el botón “?” de cualquier pantalla.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onDismiss}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition hover:border-blue hover:text-blue">
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
         className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 text-sm sm:px-5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-sky" aria-hidden />
      <p className="min-w-0 flex-1 text-muted">
        ¿Nuevo por aquí?{" "}
        <button onClick={onStart} className="font-medium text-sky underline-offset-2 transition hover:underline">
          Iniciar tutorial
        </button>
      </p>
      <button onClick={onDismiss} aria-label="Ocultar el aviso del tutorial"
              className="shrink-0 rounded p-1 text-muted transition hover:text-fg">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
