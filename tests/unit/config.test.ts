// tests/unit/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "@/lib/config";

const required = [
  "NOTION_TOKEN",
  "NOTION_DATABASE_ID",
  "DATE_COLUMN",
  "SESSION_SECRET",
  "CRON_SECRET",
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ALLOWED_EMAIL_DOMAINS",
  "APP_ORIGIN",
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
    expect(cfg.googleClientId).toBe("test-GOOGLE_CLIENT_ID");
    expect(cfg.googleClientSecret).toBe("test-GOOGLE_CLIENT_SECRET");
    expect(cfg.allowedEmailDomains).toBe("test-ALLOWED_EMAIL_DOMAINS");
    expect(cfg.appOrigin).toBe("test-APP_ORIGIN");
  });

  it("exige las 10 vars", () => {
    expect(required).toHaveLength(10);
    for (const k of required) {
      const saved = process.env[k];
      delete process.env[k];
      expect(() => loadConfig(), `${k} debería ser obligatoria`).toThrow(new RegExp(k));
      process.env[k] = saved;
    }
  });

  it("ya no exige el password compartido", () => {
    delete process.env.APP_PASSWORD_HASH;
    expect(() => loadConfig()).not.toThrow();
  });

  it("throws listing missing vars", () => {
    delete process.env.NOTION_TOKEN;
    delete process.env.SESSION_SECRET;
    expect(() => loadConfig()).toThrow(/NOTION_TOKEN.*SESSION_SECRET/);
  });
});
