import { describe, it, expect, beforeEach } from "vitest";
import { hasSeenWelcome, markWelcomeSeen, ONBOARDING_KEY } from "@/lib/tour/storage";

function fakeStorage(onSet?: () => void): Storage {
  let store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { onSet?.(); store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

const setStorage = (s: Storage | undefined) => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage = s as Storage;
};

beforeEach(() => { setStorage(fakeStorage()); });

describe("tour/storage", () => {
  it("arranca sin haber visto la bienvenida y la marca", () => {
    expect(hasSeenWelcome()).toBe(false);
    markWelcomeSeen();
    expect(hasSeenWelcome()).toBe(true);
  });

  it("tolera JSON corrupto", () => {
    localStorage.setItem(ONBOARDING_KEY, "{no json");
    expect(hasSeenWelcome()).toBe(false);
  });

  it("tolera un valor con forma inesperada", () => {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(["nope"]));
    expect(hasSeenWelcome()).toBe(false);
  });

  it("no lanza si localStorage no existe (SSR)", () => {
    setStorage(undefined);
    expect(() => hasSeenWelcome()).not.toThrow();
    expect(hasSeenWelcome()).toBe(false);
    expect(() => markWelcomeSeen()).not.toThrow();
  });

  it("no lanza si la cuota está agotada", () => {
    setStorage(fakeStorage(() => { throw new DOMException("quota", "QuotaExceededError"); }));
    expect(() => markWelcomeSeen()).not.toThrow();
  });
});
