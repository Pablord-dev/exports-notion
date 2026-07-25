// Persistencia de chats del Asistente en localStorage (client-side).
// No hay usuarios en la app, así que los chats viven en el navegador de cada
// quien (enfoque local-first). Los helpers puros se testean; el acceso a
// localStorage es tolerante a SSR, cuota y JSON corrupto.

export interface StoredTrace { name: string; args: string; ok: boolean }
export interface StoredMsg { role: "user" | "assistant"; content: string; trace?: StoredTrace[] }
export interface StoredChat {
  id: string;
  title: string;
  db: string;
  provider: string;
  messages: StoredMsg[];
  createdAt: number;
  updatedAt: number;
}

const KEY = "asistente-chats-v1";

// ---- Helpers puros ----
export function deriveTitle(messages: StoredMsg[]): string {
  const first = messages.find((m) => m.role === "user");
  const t = (first?.content ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "Nuevo chat";
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

export function sortChats(list: StoredChat[]): StoredChat[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function upsertChat(list: StoredChat[], chat: StoredChat): StoredChat[] {
  return sortChats([chat, ...list.filter((c) => c.id !== chat.id)]);
}

export function removeChat(list: StoredChat[], id: string): StoredChat[] {
  return list.filter((c) => c.id !== id);
}

// ---- Persistencia (localStorage) ----
function read(): StoredChat[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredChat[]) : [];
  } catch {
    return [];
  }
}

function write(list: StoredChat[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* cuota agotada o modo privado: se ignora */
  }
}

export function loadChats(): StoredChat[] {
  return sortChats(read());
}

export function saveChat(chat: StoredChat): StoredChat[] {
  const next = upsertChat(read(), chat);
  write(next);
  return next;
}

export function deleteChat(id: string): StoredChat[] {
  const next = removeChat(read(), id);
  write(next);
  return next;
}

export function newChatId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
