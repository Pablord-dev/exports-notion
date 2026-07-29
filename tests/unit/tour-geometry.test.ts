import { describe, it, expect } from "vitest";
import {
  popoverPlacement, POPOVER_W, POPOVER_H, GAP, MARGIN,
  type Rect, type Viewport,
} from "@/lib/tour/geometry";

const vp: Viewport = { width: 1280, height: 800 };
const rect = (top: number, left: number, width = 200, height = 60): Rect => ({ top, left, width, height });

describe("popoverPlacement", () => {
  it("sin ancla centra el globo en el viewport", () => {
    const p = popoverPlacement(null, vp);
    expect(p.side).toBe("center");
    expect(p.mobile).toBe(false);
    expect(p.left).toBe((1280 - POPOVER_W) / 2);
    expect(p.top).toBe((800 - POPOVER_H) / 2);
  });

  it("por default va debajo del ancla cuando cabe", () => {
    const p = popoverPlacement(rect(100, 500), vp);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(100 + 60 + GAP);
    // alineado al borde izquierdo del ancla
    expect(p.left).toBe(500);
  });

  it("voltea a arriba cuando abajo no cabe", () => {
    // ancla al pie: 700 + 60 + 12 + 200 = 972 > 800 - 8
    const p = popoverPlacement(rect(700, 500), vp);
    expect(p.side).toBe("top");
    expect(p.top).toBe(700 - GAP - POPOVER_H);
  });

  it("si ningún lado vertical cabe, conserva el preferido y acota al viewport", () => {
    const tall = { width: 1280, height: 240 };
    const p = popoverPlacement(rect(90, 500), tall);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(240 - POPOVER_H - MARGIN);
    expect(p.top).toBeGreaterThanOrEqual(MARGIN);
  });

  it("side=right coloca a la derecha del ancla y voltea a la izquierda si no cabe", () => {
    const cabe = popoverPlacement(rect(300, 100), vp, "right");
    expect(cabe.side).toBe("right");
    expect(cabe.left).toBe(100 + 200 + GAP);

    const noCabe = popoverPlacement(rect(300, 1100), vp, "right");
    expect(noCabe.side).toBe("left");
    expect(noCabe.left).toBe(1100 - GAP - POPOVER_W);
  });

  it("acota horizontalmente cuando el ancla está pegada al borde derecho", () => {
    const p = popoverPlacement(rect(100, 1240, 40, 40), vp);
    expect(p.left).toBe(1280 - POPOVER_W - MARGIN);
  });

  it("acota horizontalmente cuando el ancla está pegada al borde izquierdo", () => {
    const p = popoverPlacement(rect(100, -30), vp);
    expect(p.left).toBe(MARGIN);
  });

  it("en móvil manda el globo al pie a ancho completo", () => {
    const p = popoverPlacement(rect(100, 20), { width: 390, height: 844 });
    expect(p.mobile).toBe(true);
    expect(p.top).toBe(844 - POPOVER_H - MARGIN);
    expect(p.left).toBe(MARGIN);
  });

  it("en móvil ignora el ancla ausente y sigue al pie", () => {
    const p = popoverPlacement(null, { width: 390, height: 844 });
    expect(p.mobile).toBe(true);
    expect(p.top).toBe(844 - POPOVER_H - MARGIN);
  });
});
