// Contrato del recorrido guiado (onboarding). Sin runtime: sólo tipos.
// Los guiones viven en scripts.ts; el motor en app/components/tour/.

/** Un guión por superficie autenticada. */
export type TourId = "menu" | "reports" | "asistente";

/**
 * Acciones que un paso puede pedirle a su página. Nunca destructivas: sólo
 * abren y cierran cosas. La página decide cómo se ejecutan (pasa handlers a
 * AppShell); el guión sólo las nombra.
 */
export type TourActionId =
  | "openSidebar"
  | "closeSidebar"
  | "openExportModal"
  | "openSyncModal"
  | "closeModal";

export type Side = "top" | "bottom" | "left" | "right";

export interface TourStep {
  /** Elemento con data-tour="<anchor>". Ausente = globo centrado, sin recorte. */
  anchor?: string;
  title: string;
  /** Texto plano: no se renderiza markdown (no arrastramos react-markdown aquí). */
  body: string;
  /** Lado preferido del globo; geometry lo voltea si no cabe. Default: "bottom". */
  side?: Side;
  /** Se ejecuta al ENTRAR al paso, antes de buscar el ancla. */
  before?: TourActionId;
  /**
   * Se ejecuta al SALIR del paso en cualquier dirección — avanzar, retroceder,
   * saltar, Esc o terminar. Es la garantía de que un tour abortado no deja un
   * modal abierto.
   */
  after?: TourActionId;
}

export interface TourScript {
  id: TourId;
  steps: TourStep[];
  /** Encadenado opt-in: botón extra en el último paso. */
  next?: { href: string; tour: TourId; label: string };
}
