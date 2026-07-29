"use client";
// Motor del recorrido guiado.
//
// Vive dentro de AppShell y recibe por props el guión de la página y sus
// acciones. No usa contexto: AppShell es HIJO de cada página, así que un
// contexto declarado aquí no alcanzaría al componente que tiene el setModal.
//
// El spotlight son dos capas: un blocker a pantalla completa que se come los
// clicks (las box-shadow no capturan punteros) y encima un recorte con una
// sombra gigante que oscurece todo menos el ancla. Por eso ilumina elementos de
// cualquier z-index de la página: el recorte es transparente.
import { useCallback, useEffect, useRef, useState } from "react";
import { popoverPlacement, type Placement, type Rect } from "@/lib/tour/geometry";
import { tourScript } from "@/lib/tour/scripts";
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/tour/storage";
import type { TourActionId, TourId } from "@/lib/tour/types";
import { TourPopover } from "./tour-popover";
import { WelcomeBanner, WelcomeModal } from "./welcome";

export interface TourBinding {
  id: TourId;
  /** Handlers de las acciones que pide el guión de esta página. */
  actions?: Partial<Record<TourActionId, () => void>>;
}

type Actions = Partial<Record<TourActionId, () => void>>;

const anchorSelector = (anchor: string) => `[data-tour="${anchor}"]`;

function readRect(anchor: string): Rect | null {
  const el = document.querySelector<HTMLElement>(anchorSelector(anchor));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourLayer({ tour, shellActions, justLoggedIn = false }: {
  tour: TourBinding;
  shellActions: Actions;
  /** true sólo tras un login exitoso en esta carga de página. */
  justLoggedIn?: boolean;
}) {
  const script = tourScript(tour.id);
  const steps = script.steps;

  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const dirRef = useRef<1 | -1>(1);
  const cleanupRef = useRef<TourActionId | null>(null);
  const helpRef = useRef<HTMLButtonElement>(null);

  // "none" hasta que se resuelve en cliente: localStorage no existe en SSR.
  const [welcome, setWelcome] = useState<"none" | "modal" | "banner">("none");

  useEffect(() => {
    if (!justLoggedIn) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasSeenWelcome()) { setWelcome("banner"); return; }
    // Se marca al MOSTRARLO, no al completarlo: la promesa es "una vez por
    // navegador", incluso si eligen "Ahora no".
    markWelcomeSeen();
    setWelcome("modal");
  }, [justLoggedIn]);

  const active = index !== null;
  const step = index === null ? null : steps[index];

  const runAction = useCallback((id: TourActionId | null | undefined) => {
    if (!id) return;
    (tour.actions?.[id] ?? shellActions[id])?.();
  }, [tour, shellActions]);

  const start = useCallback(() => {
    setWelcome("none");
    dirRef.current = 1;
    setIndex(0);
  }, []);

  const stop = useCallback(() => {
    runAction(cleanupRef.current);
    cleanupRef.current = null;
    setIndex(null);
    setRect(null);
    setPlacement(null);
    helpRef.current?.focus();
  }, [runAction]);

  const goTo = useCallback((i: number, dir: 1 | -1) => {
    if (i < 0 || i >= steps.length) { stop(); return; }
    dirRef.current = dir;
    setIndex(i);
  }, [steps.length, stop]);

  const next = useCallback(() => {
    if (index === null) return;
    if (index === steps.length - 1) { stop(); return; }
    goTo(index + 1, 1);
  }, [index, steps.length, goTo, stop]);

  const prev = useCallback(() => {
    if (index === null || index === 0) return;
    goTo(index - 1, -1);
  }, [index, goTo]);

  /**
   * Un paso cuyo ancla no está en el DOM se omite en la dirección en la que
   * veníamos; si no queda ninguno, el tour termina limpio (corriendo el after
   * pendiente). Cubre tanto anclas condicionales como un data-tour borrado por
   * accidente en un refactor.
   */
  const skipFrom = useCallback((i: number, anchor: string) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[tour] paso omitido: no existe [data-tour="${anchor}"]`);
    }
    const to = i + dirRef.current;
    if (to < 0 || to >= steps.length) stop();
    else setIndex(to);
  }, [steps.length, stop]);

  // Al entrar a un paso: cierra lo del paso anterior y abre lo que este pida.
  useEffect(() => {
    if (index === null) return;
    const s = steps[index];
    runAction(cleanupRef.current);
    cleanupRef.current = s.after ?? null;
    runAction(s.before);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlacement(null);
  }, [index, steps, runAction]);

  // Medición: se hace después del before (el ancla de un modal no existe hasta
  // que el modal se abre) y en un rAF, para medir ya pintado. Si el ancla no
  // aparece, el paso se omite en la dirección en la que veníamos.
  useEffect(() => {
    if (index === null) return;
    const s = steps[index];
    const vp = { width: window.innerWidth, height: window.innerHeight };

    if (!s.anchor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null);
      setPlacement(popoverPlacement(null, vp, s.side));
      return;
    }

    let raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(anchorSelector(s.anchor!));
      if (!el) { skipFrom(index, s.anchor!); return; }
      // Scroll instantáneo a propósito: con "smooth" habría que esperar el
      // final de la animación para medir, y eso vuelve frágil el E2E.
      el.scrollIntoView({ block: "center", behavior: "auto" });
      raf = requestAnimationFrame(() => {
        const r = readRect(s.anchor!);
        setRect(r);
        setPlacement(popoverPlacement(r, { width: window.innerWidth, height: window.innerHeight }, s.side));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [index, steps, skipFrom]);

  // El rect se mueve con el scroll y el resize. El listener de scroll va en
  // captura porque los eventos de scroll no burbujean: así también cachamos el
  // de los contenedores con scroll propio (las tablas de reportes).
  useEffect(() => {
    if (!active || index === null || !step?.anchor) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = readRect(step.anchor!);
        // El ancla desapareció con el tour abierto: se omite el paso en vez de
        // quedarse señalando un rect que ya no existe.
        if (!r) { skipFrom(index, step.anchor!); return; }
        setRect(r);
        setPlacement(popoverPlacement(r, { width: window.innerWidth, height: window.innerHeight }, step.side));
      });
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active, index, step, skipFrom]);

  // Teclado. En CAPTURA y cortando la propagación: si no, el Esc que cierra el
  // tour llegaría también al listener del modal que el propio tour abrió.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, stop, next, prev]);

  const isLast = index !== null && index === steps.length - 1;

  return (
    <>
      {welcome === "banner" && !active && (
        <WelcomeBanner onStart={start} onDismiss={() => setWelcome("none")} />
      )}
      {welcome === "modal" && !active && (
        <WelcomeModal onStart={start} onDismiss={() => setWelcome("none")} />
      )}

      <button ref={helpRef} onClick={start} data-tour="help-button"
              aria-label="Ayuda: iniciar el recorrido guiado" title="Recorrido guiado"
              className="fixed top-4 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface font-display text-base font-bold text-muted transition hover:border-blue hover:text-blue">
        ?
      </button>

      {active && placement && step && (
        <>
          {/* Blocker: se come los clicks. No cierra el tour a propósito —
              salir es explícito (Saltar, ✕ o Esc). */}
          <div className="fixed inset-0 z-[55]" aria-hidden />
          {rect ? (
            <div aria-hidden
                 className="pointer-events-none fixed rounded-xl ring-2 ring-sky"
                 style={{
                   top: rect.top - 4, left: rect.left - 4,
                   width: rect.width + 8, height: rect.height + 8,
                   boxShadow: "0 0 0 9999px rgba(5, 23, 88, 0.8)",
                   zIndex: 56,
                 }} />
          ) : (
            <div aria-hidden className="pointer-events-none fixed inset-0 z-[56] bg-dark-blue/80" />
          )}
          <TourPopover
            title={step.title} body={step.body}
            index={index} total={steps.length}
            placement={placement}
            nextLabel={isLast ? "Terminar" : "Siguiente"}
            onNext={next}
            onPrev={index > 0 ? prev : undefined}
            onSkip={stop}
          />
        </>
      )}
    </>
  );
}
