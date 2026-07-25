import { redirect } from "next/navigation";

// El asistente dejó de estar anidado bajo la BD: ahora vive en /asistente
// (top-level, con selector de BD adentro). Esta ruta redirige por compatibilidad.
export default function LegacyChatRedirect() {
  redirect("/asistente");
}
