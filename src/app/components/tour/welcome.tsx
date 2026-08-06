"use client";
// Dos formas de ofrecer el recorrido tras iniciar sesión:
// - Modal: sólo el primer login de este navegador (ahí sí interrumpe).
// - Notificación: en los siguientes. Entra flotando abajo a la derecha unos
//   segundos después del login y se queda hasta que la cierren o cambien de
//   página (el aviso sólo se ofrece en la carga donde ocurrió el login).
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
           className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-lg">
        <h2 id="welcome-title" className="font-display text-xl font-bold text-foreground">
          Bienvenido a ExportNotion
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          ¿Te muestro cómo funciona? Son cinco pasos y toma menos de un minuto. Puedes salir cuando
          quieras y retomarlo con el botón “?” de cualquier pantalla.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onDismiss} className="text-muted-foreground">
            Ahora no
          </Button>
          <Button ref={startRef} onClick={onStart}>
            Empezar
          </Button>
        </div>
      </div>
    </div>
  );
}

// z-30: por encima del contenido, por debajo del backdrop de la sidebar en
// overlay (z-40) y del spotlight del recorrido (z-55) — que además no coexiste
// con el aviso.
export function WelcomeBanner({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div data-testid="welcome-banner" role="status"
         className="fixed bottom-4 left-4 right-4 z-30 animate-in fade-in slide-in-from-right-6 duration-300 sm:left-auto sm:w-[30rem]">
      <div className="flex items-center gap-3 rounded-xl border border-border-strong bg-popover px-4 py-2.5 shadow-lg shadow-black/40">
        <span className="h-2 w-2 shrink-0 rounded-full bg-sky" aria-hidden />
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground">¿Nuevo por aquí?</span>{" "}
          Te muestro las pantallas en menos de un minuto.
        </p>
        {/* Sin override de hover: aclarar el azul en vez de apagarlo ya es el
            comportamiento del variant default (ver button.tsx). Este botón lo
            tenía en su className con brightness-125 y un anillo despegado por
            ring-offset-2, que resultó aparatoso. */}
        <Button size="sm" onClick={onStart} className="h-8 shrink-0">
          Iniciar tutorial
        </Button>
        <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Ocultar el aviso del tutorial"
                className="-mr-1 h-7 w-7 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
