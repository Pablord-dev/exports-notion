export class FakeRedis {
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
  async hvals(k: string): Promise<string[]> { return Array.from(this.hashes.get(k)?.values() ?? []); }
  async hlen(k: string): Promise<number> { return this.hashes.get(k)?.size ?? 0; }
  async rename(from: string, to: string) {
    const h = this.hashes.get(from); if (!h) throw new Error("no such key");
    this.hashes.set(to, h); this.hashes.delete(from); return "OK";
  }
}
