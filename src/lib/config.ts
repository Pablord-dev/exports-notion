// src/lib/config.ts
export interface AppConfig {
  notionToken: string;
  databaseId: string;
  dateColumn: string;
  appPasswordHash: string;
  sessionSecret: string;
  cronSecret: string;
  upstashUrl: string;
  upstashToken: string;
  /** Postgres (Supabase) — ADR 0006. Las UPSTASH_* se retiran al completar SB-11. */
  databaseUrl: string;
}

const KEYS: Record<keyof AppConfig, string> = {
  notionToken: "NOTION_TOKEN",
  databaseId: "NOTION_DATABASE_ID",
  dateColumn: "DATE_COLUMN",
  appPasswordHash: "APP_PASSWORD_HASH",
  sessionSecret: "SESSION_SECRET",
  cronSecret: "CRON_SECRET",
  upstashUrl: "UPSTASH_REDIS_REST_URL",
  upstashToken: "UPSTASH_REDIS_REST_TOKEN",
  databaseUrl: "DATABASE_URL",
};

export function loadConfig(): AppConfig {
  const missing: string[] = [];
  const out = {} as Record<keyof AppConfig, string>;
  for (const [field, envName] of Object.entries(KEYS) as [keyof AppConfig, string][]) {
    const v = process.env[envName];
    if (!v) missing.push(envName);
    else out[field] = v;
  }
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
  return out as AppConfig;
}
