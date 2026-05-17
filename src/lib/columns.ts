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
  // { notion: "Name", csv: "Nombre" },
  // { notion: "Status" },
  // { notion: "Created", csv: "Fecha de creación" },
];

export function csvHeaders(): string[] {
  return COLUMNS.map((c) => c.csv ?? c.notion);
}
