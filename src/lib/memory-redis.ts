// src/lib/memory-redis.ts
// Stubs en memoria para correr la app sin Upstash real (E2E_STUBS=1).
// Réplica del subconjunto de @upstash/redis que usa cache.ts, con la misma
// semántica que tests/fixtures/fakeRedis.ts (auto-JSON de set/get incluido:
// el cliente real serializa objetos y los devuelve parseados).
// Singleton en globalThis: en dev cada route puede compilar su propio module
// graph y un module-scope normal no compartiría estado entre handlers.

/* eslint-disable @typescript-eslint/no-explicit-any -- imita la superficie duck-typed del cliente real */

class MemoryRedis {
  private kv = new Map<string, any>();
  private hashes = new Map<string, Map<string, string>>();

  async get<T>(k: string): Promise<T | null> { return (this.kv.get(k) as T) ?? null; }
  async set(k: string, v: any, opts?: { nx?: boolean; ex?: number }) {
    if (opts?.nx && this.kv.has(k)) return null;
    this.kv.set(k, v);
    return "OK";
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) { if (this.kv.delete(k)) n++; this.hashes.delete(k); }
    return n;
  }
  async hset(k: string, pairs: Record<string, string>) {
    let h = this.hashes.get(k); if (!h) { h = new Map(); this.hashes.set(k, h); }
    let n = 0; for (const [f, v] of Object.entries(pairs)) { if (!h.has(f)) n++; h.set(f, v); } return n;
  }
  async hdel(k: string, ...fields: string[]) {
    const h = this.hashes.get(k); if (!h) return 0;
    let n = 0; for (const f of fields) if (h.delete(f)) n++; return n;
  }
  async hscan(k: string, _cursor: string, _opts?: { count?: number }): Promise<[string, string[]]> {
    const h = this.hashes.get(k);
    const entries: string[] = [];
    if (h) for (const [f, v] of h.entries()) entries.push(f, v);
    return ["0", entries];
  }
  async hlen(k: string): Promise<number> { return this.hashes.get(k)?.size ?? 0; }
  async rename(from: string, to: string) {
    const h = this.hashes.get(from); if (!h) throw new Error("no such key");
    this.hashes.set(to, h); this.hashes.delete(from); return "OK";
  }
}

const G = globalThis as { __memoryRedis?: MemoryRedis; __memoryRatelimits?: Map<string, { count: number; resetAt: number }> };

export function memoryRedis(): MemoryRedis {
  G.__memoryRedis ??= new MemoryRedis();
  return G.__memoryRedis;
}

/** Rate limiter en memoria (ventana fija) con la interfaz mínima de @upstash/ratelimit. */
export function memoryRatelimit(limit: number, windowMs: number) {
  G.__memoryRatelimits ??= new Map();
  const hits = G.__memoryRatelimits;
  return {
    async limit(id: string): Promise<{ success: boolean }> {
      const now = Date.now();
      const cur = hits.get(id);
      if (!cur || now >= cur.resetAt) {
        hits.set(id, { count: 1, resetAt: now + windowMs });
        return { success: true };
      }
      cur.count++;
      return { success: cur.count <= limit };
    },
  };
}
