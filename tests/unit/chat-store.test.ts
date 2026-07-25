import { describe, it, expect, beforeEach } from "vitest";
import { deriveTitle, upsertChat, removeChat, sortChats, loadChats, saveChat, deleteChat, newChatId, type StoredChat, type StoredMsg } from "@/lib/chat-store";

function fakeStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

const chat = (id: string, updatedAt: number, messages: StoredMsg[] = [{ role: "user", content: "hola" }]): StoredChat =>
  ({ id, title: "t", db: "tiempos", provider: "ollama", messages, createdAt: updatedAt, updatedAt });

beforeEach(() => { (globalThis as unknown as { localStorage: Storage }).localStorage = fakeStorage(); });

describe("chat-store helpers", () => {
  it("deriveTitle usa el primer mensaje de usuario, recortado", () => {
    expect(deriveTitle([{ role: "assistant", content: "hey" }, { role: "user", content: "  ¿Cuántas horas?  " }])).toBe("¿Cuántas horas?");
    expect(deriveTitle([])).toBe("Nuevo chat");
    expect(deriveTitle([{ role: "user", content: "a".repeat(60) }])).toBe(`${"a".repeat(40)}…`);
  });

  it("upsertChat reemplaza por id y ordena por updatedAt desc", () => {
    let list = upsertChat([chat("a", 1)], chat("b", 2));
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
    list = upsertChat(list, chat("a", 3));
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
    expect(list).toHaveLength(2);
  });

  it("removeChat quita por id", () => {
    expect(removeChat([chat("a", 1), chat("b", 2)], "a").map((c) => c.id)).toEqual(["b"]);
  });

  it("sortChats ordena por updatedAt desc sin mutar", () => {
    const orig = [chat("a", 1), chat("b", 3), chat("c", 2)];
    expect(sortChats(orig).map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(orig.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("chat-store persistencia (localStorage)", () => {
  it("save/load/delete round-trip", () => {
    expect(loadChats()).toEqual([]);
    saveChat(chat("a", 1));
    saveChat(chat("b", 2));
    expect(loadChats().map((c) => c.id)).toEqual(["b", "a"]);
    deleteChat("b");
    expect(loadChats().map((c) => c.id)).toEqual(["a"]);
  });

  it("loadChats tolera JSON corrupto", () => {
    localStorage.setItem("asistente-chats-v1", "{no json");
    expect(loadChats()).toEqual([]);
  });

  it("newChatId genera ids distintos", () => {
    expect(newChatId()).not.toBe(newChatId());
  });
});
