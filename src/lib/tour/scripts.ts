// Contenido del onboarding: los tres guiones como datos.
//
// Viven centralizados (y no junto a cada página) para poder revisar toda la
// copy de una sentada. El riesgo de que un refactor borre un data-tour y el
// paso se omita en silencio lo cubre el E2E, que verifica el contador paso por
// paso (tests/e2e/onboarding.spec.ts).
import { DATABASES } from "@/lib/databases";
import type { TourId, TourScript } from "./types";

// El menú puede listar varias BDs cuando crezca databases.ts: el tour apunta a
// la primera tarjeta y encadena a ESA BD, en vez de hardcodear /db/tiempos.
const firstDb = DATABASES[0];

const menu: TourScript = {
  id: "menu",
  steps: [
    {
      title: "Bienvenido a ExportNotion",
      body:
        "Esta app sirve reportes y descargas de CSV desde una copia de tus bases de Notion. " +
        "No consulta Notion en vivo: la copia se refresca sola una vez al día, así las consultas son inmediatas.",
    },
    {
      anchor: "menu-asistente",
      title: "Asistente IA",
      body:
        "Pregunta en español —“¿cuántas horas registró cada persona en junio?”— y responde " +
        "consultando los mismos reportes que ves en esta app, no de memoria.",
    },
    {
      anchor: "menu-db-card",
      title: "Tus bases de datos",
      body:
        "Cada tarjeta es una base y toda ella es clickeable: te lleva a sus reportes, donde también " +
        "viven la exportación a CSV y la sincronización. El número son los registros que tiene la " +
        "copia y abajo dice hace cuánto se sincronizó.",
    },
    {
      anchor: "shell-sidebar",
      title: "Navegación",
      body:
        "Desde aquí saltas entre pantallas y cierras sesión. El ícono de panel ancla la barra o la " +
        "esconde detrás del botón ☰; la app recuerda tu preferencia.",
      side: "right",
      before: "openSidebar",
      after: "closeSidebar",
    },
    {
      anchor: "help-button",
      title: "Este botón te trae de vuelta",
      body:
        "El “?” repite la guía de la pantalla en la que estés, cuando quieras. Es el mismo recorrido, " +
        "sin necesidad de volver a iniciar sesión.",
      side: "left",
    },
  ],
  ...(firstDb
    ? { next: { href: `/db/${firstDb.slug}/reports`, tour: "reports" as TourId, label: `Continuar en ${firstDb.name}` } }
    : {}),
};

const reports: TourScript = {
  id: "reports",
  steps: [
    {
      anchor: "reports-snapshot",
      title: "El estado de la copia",
      body:
        "Cuántos registros tiene la copia y hace cuánto se sincronizó. Si dice 0 registros, hay que " +
        "sincronizar antes de que los reportes o la descarga tengan algo que mostrar.",
    },
    {
      anchor: "reports-filters",
      title: "Filtros combinables",
      body:
        "Rango de fechas más Persona, Subproyecto, Proyecto y Empresa. Todos son opcionales y se " +
        "combinan entre sí; sin nada seleccionado ves todos los registros. Si eliges exactamente " +
        "una persona (o un subproyecto) aparece un reporte extra: su matriz de horas por semana.",
    },
    {
      anchor: "reports-totals",
      title: "Totales del corte",
      body:
        "Horas, registros y personas activas de lo que dejaron ver los filtros — no del total de la " +
        "base. Cambia un filtro y estos tres números cambian con él.",
    },
    {
      anchor: "reports-timeline",
      title: "Evolución de horas",
      body:
        "La gráfica agrupa por semana o por mes, con los botones de la esquina. Click en una barra " +
        "abre los registros individuales de ese periodo.",
    },
    {
      anchor: "reports-tables",
      title: "Horas por persona y por subproyecto",
      body:
        "Una sola tarjeta con pestañas para cambiar de dimensión, ordenada de mayor a menor y con " +
        "una barra de participación por fila. Click en una fila abre su detalle. Las filas “(sin " +
        "persona)” y “(sin subproyecto)” agrupan lo que no tiene esa relación en Notion, y por eso " +
        "no son clickeables.",
    },
    {
      anchor: "export-modal",
      title: "Exportar a CSV",
      body:
        "El rango es opcional y filtra por fecha de creación: con ambos campos vacíos se descarga " +
        "toda la copia. El archivo sale en UTF-8, una fila por registro.",
      before: "openExportModal",
      after: "closeModal",
    },
    {
      anchor: "sync-modal",
      title: "Sincronizar con Notion",
      body:
        "Incremental trae sólo lo editado desde la última vez y tarda segundos; corre solo una vez " +
        "al día, y la cuenta regresiva marca la próxima. Full reconstruye la copia completa, tarda " +
        "minutos y sólo se dispara a mano. Si ya hay una sincronización en curso, aquí ves su avance " +
        "y puedes cancelarla guardando lo que alcanzó a descargar.",
      before: "openSyncModal",
      after: "closeModal",
    },
  ],
  next: { href: "/asistente", tour: "asistente", label: "Continuar en el Asistente IA" },
};

const asistente: TourScript = {
  id: "asistente",
  steps: [
    {
      anchor: "chat-composer",
      title: "Pregunta en lenguaje natural",
      body:
        "Escribe tu pregunta y el modelo elige qué reporte consultar para responderla. Los números " +
        "salen de la base, no del modelo.",
      side: "top",
    },
    {
      anchor: "chat-selectors",
      title: "Base y modelo",
      body:
        "Eliges sobre qué base preguntas y con qué modelo responde. Si dice “— sin modelo —”, falta " +
        "configurar uno en el servidor y el chat queda deshabilitado.",
      side: "top",
    },
    {
      anchor: "chat-history",
      title: "Tus conversaciones",
      body:
        "El historial se guarda en este navegador, no en el servidor: no lo verás desde otra " +
        "computadora, y se borra chat por chat con el ícono de bote.",
      side: "right",
    },
    {
      title: "Cómo verificar una respuesta",
      body:
        "Debajo de cada respuesta aparecen etiquetas con las herramientas que consultó para " +
        "contestar. Si no aparece ninguna, el modelo respondió sin consultar datos y conviene " +
        "desconfiar del número.",
    },
  ],
};

export const TOURS: Record<TourId, TourScript> = { menu, reports, asistente };

export function tourScript(id: TourId): TourScript {
  return TOURS[id];
}
