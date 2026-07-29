// Posición del globo del tour: función pura sobre rects, sin tocar el DOM.
// El motor mide con getBoundingClientRect y le pasa el resultado aquí, así
// esta aritmética —la única delicada del tour— se prueba en Vitest (que corre
// en entorno "node", sin DOM).
import type { Side } from "./types";

export type { Side };

export interface Rect { top: number; left: number; width: number; height: number }
export interface Viewport { width: number; height: number }

export interface Placement {
  top: number;
  left: number;
  side: Side | "center";
  /** true = viewport angosto: el globo va al pie, a ancho completo. */
  mobile: boolean;
}

/** Ancho fijo del globo en desktop. */
export const POPOVER_W = 320;
/** Alto estimado del globo: sólo se usa para decidir el lado y acotar. */
export const POPOVER_H = 200;
/** Aire entre el ancla y el globo. */
export const GAP = 12;
/** Margen mínimo contra los bordes del viewport. */
export const MARGIN = 8;
/** Por debajo de este ancho se usa el layout móvil. */
export const MOBILE_MAX = 640;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function popoverPlacement(
  anchor: Rect | null,
  vp: Viewport,
  preferred: Side = "bottom",
): Placement {
  // Móvil: el ancla puede quedar en cualquier parte; el globo siempre al pie.
  if (vp.width < MOBILE_MAX) {
    return { top: vp.height - POPOVER_H - MARGIN, left: MARGIN, side: "bottom", mobile: true };
  }

  if (!anchor) {
    return {
      top: (vp.height - POPOVER_H) / 2,
      left: (vp.width - POPOVER_W) / 2,
      side: "center",
      mobile: false,
    };
  }

  const maxTop = vp.height - POPOVER_H - MARGIN;
  const maxLeft = vp.width - POPOVER_W - MARGIN;
  const vertical = preferred === "top" || preferred === "bottom";

  if (vertical) {
    const below = anchor.top + anchor.height + GAP;
    const above = anchor.top - GAP - POPOVER_H;
    const fitsBelow = below <= maxTop;
    const fitsAbove = above >= MARGIN;
    // Se voltea sólo si el preferido no cabe y el opuesto sí; si ninguno cabe,
    // conserva el preferido y se acota (mejor tapar algo que salirse).
    const side: Side = preferred === "bottom"
      ? (fitsBelow || !fitsAbove ? "bottom" : "top")
      : (fitsAbove || !fitsBelow ? "top" : "bottom");
    return {
      top: clamp(side === "bottom" ? below : above, MARGIN, Math.max(MARGIN, maxTop)),
      left: clamp(anchor.left, MARGIN, Math.max(MARGIN, maxLeft)),
      side,
      mobile: false,
    };
  }

  const right = anchor.left + anchor.width + GAP;
  const left = anchor.left - GAP - POPOVER_W;
  const fitsRight = right <= maxLeft;
  const fitsLeft = left >= MARGIN;
  const side: Side = preferred === "right"
    ? (fitsRight || !fitsLeft ? "right" : "left")
    : (fitsLeft || !fitsRight ? "left" : "right");
  return {
    top: clamp(anchor.top, MARGIN, Math.max(MARGIN, maxTop)),
    left: clamp(side === "right" ? right : left, MARGIN, Math.max(MARGIN, maxLeft)),
    side,
    mobile: false,
  };
}
