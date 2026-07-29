// Estado del onboarding en localStorage. No hay identidad de usuario en la app
// (un solo password compartido), así que "sesión nueva" sólo puede distinguirse
// por navegador. Tolerante a SSR, JSON corrupto y cuota agotada, igual que
// src/lib/chat-store.ts.

export const ONBOARDING_KEY = "onboarding-v1";

interface OnboardingState { welcomeSeen?: boolean }

function read(): OnboardingState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ONBOARDING_KEY) : null;
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Array o primitivo => forma inesperada: se trata como estado vacío.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as OnboardingState)
      : {};
  } catch {
    return {};
  }
}

/** true si este navegador ya vio el modal de bienvenida alguna vez. */
export function hasSeenWelcome(): boolean {
  return read().welcomeSeen === true;
}

/**
 * Se llama al MOSTRAR el modal, no al completar el tour: la promesa es
 * "el modal aparece una vez por navegador", incluso si eligen "Ahora no".
 */
export function markWelcomeSeen(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ ...read(), welcomeSeen: true }));
  } catch {
    /* cuota agotada o modo privado: se ignora */
  }
}
