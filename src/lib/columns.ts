// src/lib/columns.ts
export interface ColumnDef {
  /** Nombre exacto de la propiedad en Notion */
  notion: string;
  /** Nombre del header en el CSV (default = notion) */
  csv?: string;
}

/**
 * Whitelist de columnas exportadas. Edita esta lista para agregar/quitar
 * propiedades visibles. Cualquier propiedad que no esté aquí NO se
 * incluye en el cache ni en el CSV.
 *
 * El orden de esta lista determina el orden de columnas en el CSV.
 */
export const COLUMNS: ColumnDef[] = [
  { notion: "Breve descripción" },
  { notion: "Empresa productiva" },
  { notion: "Hecho por" },
  { notion: "Hecho por (no tocar)" },
  { notion: "Hito" },
  { notion: "Hito (no tocar)" },
  { notion: "Hora de creación" },
  { notion: "Hora de finalización" },
  { notion: "Hora de última edición" },
  { notion: "ID" },
  { notion: "Persona" },
  { notion: "Proyecto" },
  { notion: "Proyecto (no tocar)" },
  { notion: "Registro de horas" },
  { notion: "Subproyecto" },
  { notion: "Subproyecto (Nombre)" },
  { notion: "Subproyecto (no tocar)" },
  { notion: "Tarea" },
  { notion: "Tarea (no tocar)" },
  { notion: "Último editor" },
  { notion: "Validación" },
];

export function csvHeaders(): string[] {
  return COLUMNS.map((c) => c.csv ?? c.notion);
}
