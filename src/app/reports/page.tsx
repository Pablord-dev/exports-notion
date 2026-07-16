import { redirect } from "next/navigation";

// Ruta previa al menú principal de BDs: los reportes viven ahora bajo su BD.
// Se conserva como redirect para bookmarks y links viejos.
export default function LegacyReports() {
  redirect("/db/tiempos/reports");
}
