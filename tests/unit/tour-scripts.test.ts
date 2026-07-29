import { describe, it, expect } from "vitest";
import { TOURS, tourScript } from "@/lib/tour/scripts";
import type { TourId } from "@/lib/tour/types";

const IDS: TourId[] = ["menu", "reports", "asistente"];
const all = IDS.map((id) => TOURS[id]);

describe("guiones del tour", () => {
  it("hay un guión por superficie y su id coincide con la llave", () => {
    for (const id of IDS) expect(TOURS[id].id).toBe(id);
    expect(tourScript("menu")).toBe(TOURS.menu);
  });

  it("todo paso tiene título y cuerpo no vacíos", () => {
    for (const s of all) {
      expect(s.steps.length).toBeGreaterThan(0);
      for (const step of s.steps) {
        expect(step.title.trim()).not.toBe("");
        expect(step.body.trim()).not.toBe("");
      }
    }
  });

  it("las anclas no se repiten dentro de un guión", () => {
    for (const s of all) {
      const anchors = s.steps.map((st) => st.anchor).filter(Boolean);
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });

  it("todo paso que abre algo declara cómo cerrarlo", () => {
    const abre = new Set(["openSidebar", "openExportModal", "openSyncModal"]);
    for (const s of all) {
      for (const step of s.steps) {
        if (step.before && abre.has(step.before)) expect(step.after).toBeTruthy();
      }
    }
  });

  it("el encadenado apunta a un guión existente y sólo desde el último paso", () => {
    for (const s of all) {
      if (!s.next) continue;
      expect(IDS).toContain(s.next.tour);
      expect(s.next.tour).not.toBe(s.id);
      expect(s.next.href.startsWith("/")).toBe(true);
      expect(s.next.label.trim()).not.toBe("");
    }
  });

  it("el menú encadena a reportes y el asistente cierra la cadena", () => {
    expect(TOURS.menu.next?.tour).toBe("reports");
    expect(TOURS.reports.next?.tour).toBe("asistente");
    expect(TOURS.asistente.next).toBeUndefined();
  });

  it("los conteos de pasos son los del spec", () => {
    expect(TOURS.menu.steps).toHaveLength(5);
    expect(TOURS.reports.steps).toHaveLength(7);
    expect(TOURS.asistente.steps).toHaveLength(4);
  });

  it("el destino del encadenado del menú se deriva de DATABASES, no está hardcodeado", () => {
    expect(TOURS.menu.next?.href).toBe("/db/tiempos/reports");
  });
});
