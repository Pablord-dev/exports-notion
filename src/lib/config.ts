// src/lib/config.ts
export interface AppConfig {
  notionToken: string;
  databaseId: string;
  dateColumn: string;
  sessionSecret: string;
  cronSecret: string;
  /** Postgres (Supabase) — ADR 0006. */
  databaseUrl: string;
  /** Login con Google — ADR 0008. */
  googleClientId: string;
  googleClientSecret: string;
  /** Dominios autorizados, separados por comas. Vacío = nadie entra. */
  allowedEmailDomains: string;
  /** Origin público de esta instancia. El redirect_uri se arma con él y tiene
   *  que coincidir carácter por carácter con el registrado en Google; derivarlo
   *  del request rompe en cuanto un proxy reescribe el Host, y sólo en producción. */
  appOrigin: string;
}

const KEYS: Record<keyof AppConfig, string> = {
  notionToken: "NOTION_TOKEN",
  databaseId: "NOTION_DATABASE_ID",
  dateColumn: "DATE_COLUMN",
  sessionSecret: "SESSION_SECRET",
  cronSecret: "CRON_SECRET",
  databaseUrl: "DATABASE_URL",
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  allowedEmailDomains: "ALLOWED_EMAIL_DOMAINS",
  appOrigin: "APP_ORIGIN",
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
