// tests/unit/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "@/lib/config";

const required = [
  "NOTION_TOKEN",
  "NOTION_DATABASE_ID",
  "DATE_COLUMN",
  "APP_PASSWORD_HASH",
  "SESSION_SECRET",
  "CRON_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

describe("loadConfig", () => {
  const original = { ...process.env };
  beforeEach(() => { for (const k of required) process.env[k] = `test-${k}`; });
  afterEach(() => { process.env = { ...original }; });

  it("returns a typed config when all env vars are present", () => {
    const cfg = loadConfig();
    expect(cfg.notionToken).toBe("test-NOTION_TOKEN");
    expect(cfg.databaseId).toBe("test-NOTION_DATABASE_ID");
    expect(cfg.dateColumn).toBe("test-DATE_COLUMN");
  });

  it("throws listing missing vars", () => {
    delete process.env.NOTION_TOKEN;
    delete process.env.SESSION_SECRET;
    expect(() => loadConfig()).toThrow(/NOTION_TOKEN.*SESSION_SECRET/);
  });
});
