// Registro de las bases de Notion que la herramienta expone en el menú
// principal. Hoy el backend es single-DB (una sola `NOTION_DATABASE_ID`,
// una tabla `pages`): agregar una entrada aquí solo agrega la tarjeta al
// menú — soportar otra BD de verdad requiere el trabajo multi-BD del
// backend (config por BD, snapshot por BD, sync por BD).
export interface DatabaseDef {
  /** Segmento de URL: /db/<slug> y /db/<slug>/reports */
  slug: string;
  name: string;
  description: string;
}

export const DATABASES: DatabaseDef[] = [
  {
    slug: "tiempos",
    name: "BD Tiempos",
    description: "Registro de horas por persona, subproyecto y proyecto.",
  },
];
