import { redirect } from "next/navigation";

// El dashboard de export/sync se fusionó con la página de reportes (modals
// de Exportar y Sincronizar). Esta ruta queda como redirect para bookmarks.
export default function LegacyTiemposDashboard() {
  redirect("/db/tiempos/reports");
}
