# ExportNotion Webapp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Webapp interna en Next.js + Vercel que permite a colaboradores (autenticados con password compartido) descargar como CSV el contenido de una base de Notion (~11k registros), aplicando filtro de rango de fechas y respetando una whitelist de columnas.

**Architecture:** Next.js 15 App Router en TypeScript, deployado en Vercel. Upstash Redis como cache de la base (hash `pageId → FlatRow`). Sync híbrido: cron incremental cada 6 h + cron full diario + botones manuales. Export filtra en memoria y hace stream del CSV. Auth con cookie firmada (password compartido + rate limit).

**Tech Stack:** Next.js 15, TypeScript, Tailwind, `@notionhq/client`, `@upstash/redis`, `@upstash/ratelimit`, `iron-session`, `bcryptjs`, `cron-parser`, `csv-stringify`, Vitest, MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-17-notion-export-webapp-design.md`

**Branching:** ver "Branching strategy" abajo — una branch por tarea, merge a `main` al cerrar cada una.

---

## Branching strategy

Cada tarea se desarrolla en su propia branch y se mergea a `main` al final, para mantener historial limpio y permitir revertir tareas individuales.

**Naming convention:** `<tipo>/<NN>-<slug-corto>` donde:
- `<tipo>` ∈ { `feat`, `test`, `chore`, `docs` }
- `<NN>` = número de tarea con cero a la izquierda
- `<slug-corto>` = identificador kebab-case

**Pattern al inicio de cada tarea:**

```bash
git checkout main
git pull origin main
git checkout -b <tipo>/<NN>-<slug>
```

**Pattern al final de cada tarea (reemplaza el último `git commit` por esto):**

```bash
git add <archivos modificados>
git commit -m "<mensaje>"
git push -u origin <tipo>/<NN>-<slug>
git checkout main
git merge --no-ff <tipo>/<NN>-<slug> -m "Merge <tipo>/<NN>-<slug>"
git push origin main
git branch -d <tipo>/<NN>-<slug>          # local cleanup
git push origin --delete <tipo>/<NN>-<slug>  # remote cleanup
```

Si prefieres revisar vía PR antes de mergear, sustituye los pasos de `git merge`/`push` por `gh pr create --base main --fill` y mergea desde GitHub.

**Tabla de branches por tarea:**

| Task | Branch |
|---|---|
| 0  | `chore/00-scaffold` |
| 1  | `feat/01-types` |
| 2  | `feat/02-config` |
| 3  | `feat/03-columns` |
| 4  | `feat/04-flatten` |
| 5  | `feat/05-filter` |
| 6  | `feat/06-csv` |
| 7  | `feat/07-cron` |
| 8  | `feat/08-auth` |
| 9  | `feat/09-cache` |
| 10 | `feat/10-notion` |
| 11 | `feat/11-sync` |
| 12 | `test/12-sync-integration` |
| 13 | `feat/13-api-login` |
| 14 | `feat/14-middleware` |
| 15 | `feat/15-api-sync` |
| 16 | `feat/16-api-sync-status` |
| 17 | `feat/17-api-export` |
| 18 | `feat/18-ui` |
| 19 | `chore/19-vercel-config` |
| 20 | `test/20-e2e-smoke` |
| 21 | `docs/21-readme` |
| 22 | `chore/22-final-verification` |

> Las branches de docs (`spec`/`plan`) viven aparte en `origin/docs` y no se mergean a `main` mediante este flujo.

---

## File Map

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                      # UI: login + estado + descarga
│   ├── globals.css                   # Tailwind directives
│   └── api/
│       ├── login/route.ts
│       ├── sync/route.ts             # POST ?kind=incremental|full
│       ├── sync/status/route.ts      # GET
│       └── export/route.ts           # GET ?from=&to=
├── lib/
│   ├── config.ts                     # env vars validados
│   ├── columns.ts                    # WHITELIST (admin edita aquí)
│   ├── types.ts                      # FlatRow, SyncStatus, Meta, etc.
│   ├── flatten.ts                    # flattenPage(page) — lee whitelist de columns.ts
│   ├── filter.ts                     # filterByDateRange(rows, from, to, col)
│   ├── csv.ts                        # rowsToCSVStream(rows)
│   ├── cron.ts                       # nextRun(cronExpr)
│   ├── auth.ts                       # verifyPassword, session helpers
│   ├── cache.ts                      # Upstash wrappers (cache + meta + status + lock)
│   ├── notion.ts                     # fetchPages({ since? }, onProgress)
│   └── sync.ts                       # runSync({ kind })
├── middleware.ts                     # auth gate para rutas protegidas
tests/
├── unit/
│   ├── flatten.test.ts
│   ├── filter.test.ts
│   ├── csv.test.ts
│   ├── cron.test.ts
│   └── auth.test.ts
├── integration/
│   ├── sync-incremental.test.ts
│   ├── sync-full.test.ts
│   └── export.test.ts
├── e2e/
│   └── smoke.spec.ts
└── fixtures/
    └── notion-pages/                 # JSON fixtures por tipo de propiedad
vercel.json                           # crons + headers
.env.example
.env.local                            # local dev (ignorado por git)
package.json
tsconfig.json
vitest.config.ts
playwright.config.ts
postcss.config.mjs
tailwind.config.ts
next.config.mjs
README.md                             # actualizar con instrucciones
```

---

## Task 0: Scaffolding del proyecto Next.js

**Branch:** `chore/00-scaffold` (sigue el pattern de "Branching strategy" para abrir/cerrar)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (placeholder), `.env.example`, `vitest.config.ts`

- [ ] **Step 0.1: Inicializar Next.js + TypeScript + Tailwind**

```bash
npm create next-app@latest . -- --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```

Cuando pregunte si usar `app/` ya está cubierto por `--app`. Si pregunta por sobreescribir README.md/.gitignore: **no** (preserva los nuestros).

- [ ] **Step 0.2: Instalar dependencias runtime**

```bash
npm install @notionhq/client @upstash/redis @upstash/ratelimit iron-session bcryptjs cron-parser csv-stringify
npm install --save-dev @types/bcryptjs vitest @vitest/coverage-v8 msw @playwright/test
```

- [ ] **Step 0.3: Configurar Vitest**

Crear `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

Añadir scripts a `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 0.4: Crear `.env.example`**

```
# Notion
NOTION_TOKEN=
NOTION_DATABASE_ID=
DATE_COLUMN=

# App auth
APP_PASSWORD_HASH=
SESSION_SECRET=

# Cron auth
CRON_SECRET=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

- [ ] **Step 0.5: Verificar build limpio**

```bash
npm run build
```

Esperado: build exitoso sin errores.

- [ ] **Step 0.6: Commit**

```bash
git add .
git commit -m "chore: scaffold Next.js + TS + Tailwind project with testing deps"
```

---

## Task 1: Types compartidos (`src/lib/types.ts`)

**Branch:** `feat/01-types`

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1.1: Definir tipos del dominio**

```ts
// src/lib/types.ts
export type FlatRow = Record<string, string>;

export interface CacheMeta {
  lastFullAt: string | null;       // ISO
  lastIncrementalAt: string | null; // ISO
  count: number;
}

export type SyncState = "idle" | "running" | "error";
export type SyncKind = "incremental" | "full";

export interface SyncStatus {
  state: SyncState;
  kind: SyncKind | null;
  done: number;
  total: number;
  startedAt: string | null;
  error: string | null;
  skipped: number;
}

export interface SyncStatusResponse {
  status: SyncStatus;
  meta: CacheMeta;
  next: { incremental: string; full: string };
}
```

- [ ] **Step 1.2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add domain types for cache, sync, flat rows"
```

---

## Task 2: Config tipado (`src/lib/config.ts`)

**Branch:** `feat/02-config`

**Files:**
- Create: `src/lib/config.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 2.1: Escribir test**

```ts
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
```

- [ ] **Step 2.2: Correr test (debe fallar)**

```bash
npm test -- tests/unit/config.test.ts
```

Esperado: FAIL (`loadConfig` no existe).

- [ ] **Step 2.3: Implementar**

```ts
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
```

- [ ] **Step 2.4: Correr test (debe pasar)**

```bash
npm test -- tests/unit/config.test.ts
```

Esperado: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/config.ts tests/unit/config.test.ts
git commit -m "feat(config): typed env loading with missing-vars diagnostics"
```

---

## Task 3: Whitelist de columnas (`src/lib/columns.ts`)

**Branch:** `feat/03-columns`

**Files:**
- Create: `src/lib/columns.ts`

> Esta es la pieza que el admin (usuario) edita regularmente. Define qué propiedades de Notion se exponen, con qué nombre van al CSV y, opcionalmente, su tipo esperado para validación. La whitelist real la define el usuario; aquí se deja un ejemplo comentado.

- [ ] **Step 3.1: Crear estructura**

```ts
// src/lib/columns.ts
export interface ColumnDef {
  /** Nombre exacto de la propiedad en Notion */
  notion: string;
  /** Nombre del header en el CSV (default = notion) */
  csv?: string;
}

/**
 * Whitelist de columnas exportadas. Edita esta lista para agregar/quitar
 * propiedades visibles. Cualquier propiedad que no esté aquí NO se
 * incluye en el cache ni en el CSV.
 *
 * El orden de esta lista determina el orden de columnas en el CSV.
 */
export const COLUMNS: ColumnDef[] = [
  // { notion: "Name", csv: "Nombre" },
  // { notion: "Status" },
  // { notion: "Created", csv: "Fecha de creación" },
];

export function csvHeaders(): string[] {
  return COLUMNS.map((c) => c.csv ?? c.notion);
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/lib/columns.ts
git commit -m "feat(columns): scaffold whitelist module (admin will populate)"
```

---

## Task 4: Aplanado de propiedades de Notion (`src/lib/flatten.ts`)

**Branch:** `feat/04-flatten`

**Files:**
- Create: `src/lib/flatten.ts`
- Create: `tests/unit/flatten.test.ts`
- Create: `tests/fixtures/notion-pages/*.json` (uno por tipo)

> Esta es la unidad con más lógica. Maneja los tipos comunes de propiedades de Notion. Función pura: input = `PageObjectResponse`, output = `FlatRow` con solo columnas whitelisted.

- [ ] **Step 4.1: Crear fixtures mínimas**

Crear `tests/fixtures/notion-pages/sample.ts`:

```ts
// Helper para construir páginas mock con shape de Notion
export function page(properties: Record<string, any>, opts: { id?: string; archived?: boolean; last_edited_time?: string } = {}) {
  return {
    object: "page",
    id: opts.id ?? "page-1",
    archived: opts.archived ?? false,
    last_edited_time: opts.last_edited_time ?? "2026-05-17T12:00:00.000Z",
    properties,
  };
}

export const titleProp = (text: string) => ({
  id: "p1", type: "title",
  title: text ? [{ plain_text: text, type: "text" }] : [],
});

export const richTextProp = (text: string) => ({
  id: "p2", type: "rich_text",
  rich_text: text ? [{ plain_text: text, type: "text" }] : [],
});

export const numberProp = (n: number | null) => ({ id: "p3", type: "number", number: n });
export const selectProp = (name: string | null) => ({ id: "p4", type: "select", select: name ? { name } : null });
export const multiSelectProp = (names: string[]) => ({ id: "p5", type: "multi_select", multi_select: names.map((name) => ({ name })) });
export const dateProp = (start: string | null, end: string | null = null) => ({
  id: "p6", type: "date", date: start ? { start, end } : null,
});
export const checkboxProp = (v: boolean) => ({ id: "p7", type: "checkbox", checkbox: v });
export const urlProp = (v: string | null) => ({ id: "p8", type: "url", url: v });
export const emailProp = (v: string | null) => ({ id: "p9", type: "email", email: v });
export const phoneProp = (v: string | null) => ({ id: "p10", type: "phone_number", phone_number: v });
export const peopleProp = (names: string[]) => ({
  id: "p11", type: "people",
  people: names.map((name) => ({ object: "user", id: `u-${name}`, name })),
});
export const relationProp = (ids: string[]) => ({
  id: "p12", type: "relation",
  relation: ids.map((id) => ({ id })),
});
export const formulaProp = (val: any) => ({ id: "p13", type: "formula", formula: val });
export const rollupProp = (val: any) => ({ id: "p14", type: "rollup", rollup: val });
export const filesProp = (urls: string[]) => ({
  id: "p15", type: "files",
  files: urls.map((url) => ({ name: url.split("/").pop(), type: "external", external: { url } })),
});
export const statusProp = (name: string | null) => ({ id: "p16", type: "status", status: name ? { name } : null });
```

- [ ] **Step 4.2: Escribir tests (uno por tipo)**

```ts
// tests/unit/flatten.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/columns", () => ({
  COLUMNS: [
    { notion: "Title", csv: "Nombre" },
    { notion: "Desc" },
    { notion: "Score" },
    { notion: "Status" },
    { notion: "Tags" },
    { notion: "When" },
    { notion: "Done" },
    { notion: "URL" },
    { notion: "Email" },
    { notion: "Phone" },
    { notion: "People" },
    { notion: "Related" },
    { notion: "Calc" },
    { notion: "Roll" },
    { notion: "Files" },
    { notion: "Stage" },
    { notion: "Missing" },
  ],
  csvHeaders: () => [],
}));

import { flattenPage } from "@/lib/flatten";
import {
  page, titleProp, richTextProp, numberProp, selectProp, multiSelectProp,
  dateProp, checkboxProp, urlProp, emailProp, phoneProp, peopleProp,
  relationProp, formulaProp, rollupProp, filesProp, statusProp,
} from "../fixtures/notion-pages/sample";

describe("flattenPage", () => {
  it("aplana title", () => {
    const row = flattenPage(page({ Title: titleProp("Hola") }) as any);
    expect(row.Nombre).toBe("Hola");
  });

  it("aplana rich_text", () => {
    const row = flattenPage(page({ Desc: richTextProp("Mundo") }) as any);
    expect(row.Desc).toBe("Mundo");
  });

  it("number a string (incluye 0)", () => {
    expect(flattenPage(page({ Score: numberProp(0) }) as any).Score).toBe("0");
    expect(flattenPage(page({ Score: numberProp(null) }) as any).Score).toBe("");
  });

  it("select y multi_select", () => {
    expect(flattenPage(page({ Status: selectProp("Activo") }) as any).Status).toBe("Activo");
    expect(flattenPage(page({ Tags: multiSelectProp(["a","b","c"]) }) as any).Tags).toBe("a, b, c");
    expect(flattenPage(page({ Tags: multiSelectProp([]) }) as any).Tags).toBe("");
  });

  it("date: solo start vs start+end", () => {
    expect(flattenPage(page({ When: dateProp("2026-05-01") }) as any).When).toBe("2026-05-01");
    expect(flattenPage(page({ When: dateProp("2026-05-01","2026-05-10") }) as any).When).toBe("2026-05-01 → 2026-05-10");
    expect(flattenPage(page({ When: dateProp(null) }) as any).When).toBe("");
  });

  it("checkbox / url / email / phone", () => {
    expect(flattenPage(page({ Done: checkboxProp(true) }) as any).Done).toBe("true");
    expect(flattenPage(page({ URL: urlProp("https://x") }) as any).URL).toBe("https://x");
    expect(flattenPage(page({ Email: emailProp("a@b.c") }) as any).Email).toBe("a@b.c");
    expect(flattenPage(page({ Phone: phoneProp("+52 55") }) as any).Phone).toBe("+52 55");
  });

  it("people y relation con join por coma", () => {
    expect(flattenPage(page({ People: peopleProp(["Ana","Bob"]) }) as any).People).toBe("Ana, Bob");
    expect(flattenPage(page({ Related: relationProp(["abc","def"]) }) as any).Related).toBe("abc, def");
  });

  it("formula y rollup: resuelve por tipo interno", () => {
    const f = page({ Calc: formulaProp({ type: "string", string: "hi" }) }) as any;
    expect(flattenPage(f).Calc).toBe("hi");
    const f2 = page({ Calc: formulaProp({ type: "number", number: 42 }) }) as any;
    expect(flattenPage(f2).Calc).toBe("42");
    const r = page({ Roll: rollupProp({ type: "array", array: [{ type: "number", number: 1 }, { type: "number", number: 2 }] }) }) as any;
    expect(flattenPage(r).Roll).toBe("1, 2");
  });

  it("files: lista urls separadas por coma", () => {
    const f = page({ Files: filesProp(["https://x/a.png","https://x/b.png"]) }) as any;
    expect(flattenPage(f).Files).toBe("https://x/a.png, https://x/b.png");
  });

  it("status type", () => {
    expect(flattenPage(page({ Stage: statusProp("Hecho") }) as any).Stage).toBe("Hecho");
    expect(flattenPage(page({ Stage: statusProp(null) }) as any).Stage).toBe("");
  });

  it("propiedad whitelisted ausente queda vacía", () => {
    const row = flattenPage(page({}) as any);
    expect(row.Missing).toBe("");
  });

  it("ignora propiedades NO whitelisted", () => {
    const row = flattenPage(page({ Hidden: titleProp("secret"), Title: titleProp("Hola") }) as any);
    expect(row.Nombre).toBe("Hola");
    expect((row as any).Hidden).toBeUndefined();
  });
});
```

- [ ] **Step 4.3: Correr (debe fallar)**

```bash
npm test -- tests/unit/flatten.test.ts
```

Esperado: FAIL (`flattenPage` no existe).

- [ ] **Step 4.4: Implementar `flatten.ts`**

```ts
// src/lib/flatten.ts
import { COLUMNS } from "@/lib/columns";
import type { FlatRow } from "@/lib/types";

type AnyProp = Record<string, any>;

function richTextToString(arr: any[] | undefined): string {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  return arr.map((r) => r.plain_text ?? "").join("");
}

function dateToString(d: any): string {
  if (!d) return "";
  if (d.end) return `${d.start} → ${d.end}`;
  return d.start ?? "";
}

function formulaToString(f: any): string {
  if (!f) return "";
  switch (f.type) {
    case "string":  return f.string ?? "";
    case "number":  return f.number == null ? "" : String(f.number);
    case "boolean": return String(f.boolean);
    case "date":    return dateToString(f.date);
    default:        return "";
  }
}

function rollupToString(r: any): string {
  if (!r) return "";
  if (r.type === "number")  return r.number == null ? "" : String(r.number);
  if (r.type === "date")    return dateToString(r.date);
  if (r.type === "string")  return r.string ?? "";
  if (r.type === "array")   return (r.array ?? []).map(propValueToString).join(", ");
  return "";
}

function propValueToString(prop: AnyProp): string {
  if (!prop || !prop.type) return "";
  switch (prop.type) {
    case "title":         return richTextToString(prop.title);
    case "rich_text":     return richTextToString(prop.rich_text);
    case "number":        return prop.number == null ? "" : String(prop.number);
    case "select":        return prop.select?.name ?? "";
    case "status":        return prop.status?.name ?? "";
    case "multi_select":  return (prop.multi_select ?? []).map((s: any) => s.name).join(", ");
    case "date":          return dateToString(prop.date);
    case "checkbox":      return String(Boolean(prop.checkbox));
    case "url":           return prop.url ?? "";
    case "email":         return prop.email ?? "";
    case "phone_number":  return prop.phone_number ?? "";
    case "people":        return (prop.people ?? []).map((p: any) => p.name ?? p.id).join(", ");
    case "relation":      return (prop.relation ?? []).map((r: any) => r.id).join(", ");
    case "files":         return (prop.files ?? []).map((f: any) => f.external?.url ?? f.file?.url ?? "").filter(Boolean).join(", ");
    case "formula":       return formulaToString(prop.formula);
    case "rollup":        return rollupToString(prop.rollup);
    case "created_time":  return prop.created_time ?? "";
    case "last_edited_time": return prop.last_edited_time ?? "";
    default:              return "";
  }
}

export function flattenPage(page: { properties: Record<string, AnyProp> }): FlatRow {
  const out: FlatRow = {};
  for (const col of COLUMNS) {
    const key = col.csv ?? col.notion;
    const prop = page.properties[col.notion];
    out[key] = prop ? propValueToString(prop) : "";
  }
  return out;
}
```

- [ ] **Step 4.5: Correr (debe pasar)**

```bash
npm test -- tests/unit/flatten.test.ts
```

Esperado: todos los tests PASS.

- [ ] **Step 4.6: Commit**

```bash
git add src/lib/flatten.ts tests/unit/flatten.test.ts tests/fixtures/notion-pages/sample.ts
git commit -m "feat(flatten): convert Notion properties to flat string row (whitelist-aware)"
```

---

## Task 5: Filtro por rango de fechas (`src/lib/filter.ts`)

**Branch:** `feat/05-filter`

**Files:**
- Create: `src/lib/filter.ts`
- Create: `tests/unit/filter.test.ts`

- [ ] **Step 5.1: Escribir test**

```ts
// tests/unit/filter.test.ts
import { describe, it, expect } from "vitest";
import { filterByDateRange } from "@/lib/filter";

const rows = [
  { id: "1", When: "2026-01-15" },
  { id: "2", When: "2026-05-01" },
  { id: "3", When: "2026-05-17" },
  { id: "4", When: "" },                    // sin fecha
  { id: "5", When: "no-es-fecha" },         // basura
  { id: "6", When: "2026-05-10 → 2026-05-20" }, // rango (toma start)
];

describe("filterByDateRange", () => {
  it("incluye bordes (from y to inclusive)", () => {
    const r = filterByDateRange(rows, "2026-05-01", "2026-05-17", "When");
    expect(r.map((x) => x.id)).toEqual(["2", "3", "6"]);
  });
  it("sin from", () => {
    const r = filterByDateRange(rows, null, "2026-05-01", "When");
    expect(r.map((x) => x.id)).toEqual(["1", "2"]);
  });
  it("sin to", () => {
    const r = filterByDateRange(rows, "2026-05-10", null, "When");
    expect(r.map((x) => x.id)).toEqual(["3", "6"]);
  });
  it("sin from ni to: devuelve todo (incluso null/basura)", () => {
    expect(filterByDateRange(rows, null, null, "When")).toHaveLength(6);
  });
  it("filas con fecha vacía o inválida se excluyen cuando hay filtro", () => {
    const r = filterByDateRange(rows, "2026-01-01", "2026-12-31", "When");
    expect(r.map((x) => x.id)).toEqual(["1", "2", "3", "6"]);
  });
});
```

- [ ] **Step 5.2: Correr (debe fallar)**

```bash
npm test -- tests/unit/filter.test.ts
```

Esperado: FAIL.

- [ ] **Step 5.3: Implementar**

```ts
// src/lib/filter.ts
import type { FlatRow } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function parseRowDate(value: string): string | null {
  if (!value) return null;
  // si viene "2026-05-10 → 2026-05-20" tomamos el inicio
  const candidate = value.split("→")[0].trim();
  return ISO_DATE.test(candidate) ? candidate.slice(0, 10) : null;
}

export function filterByDateRange(
  rows: FlatRow[],
  from: string | null,
  to: string | null,
  dateColumn: string,
): FlatRow[] {
  if (!from && !to) return rows;
  return rows.filter((row) => {
    const d = parseRowDate(row[dateColumn] ?? "");
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}
```

- [ ] **Step 5.4: Correr (debe pasar)**

```bash
npm test -- tests/unit/filter.test.ts
```

Esperado: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/filter.ts tests/unit/filter.test.ts
git commit -m "feat(filter): date-range filter handling null/invalid dates"
```

---

## Task 6: CSV stream (`src/lib/csv.ts`)

**Branch:** `feat/06-csv`

**Files:**
- Create: `src/lib/csv.ts`
- Create: `tests/unit/csv.test.ts`

- [ ] **Step 6.1: Escribir test**

```ts
// tests/unit/csv.test.ts
import { describe, it, expect } from "vitest";
import { rowsToCSVString } from "@/lib/csv";

describe("rowsToCSVString", () => {
  it("escribe headers y filas, escape de comas/comillas/saltos", async () => {
    const csv = await rowsToCSVString(
      ["a", "b"],
      [{ a: "hola", b: "x,y" }, { a: 'con "comillas"', b: "linea1\nlinea2" }],
    );
    // BOM al inicio
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const body = csv.slice(1);
    expect(body.split("\n")[0]).toBe("a,b");
    expect(body).toContain('"x,y"');
    expect(body).toContain('"con ""comillas"""');
    expect(body).toContain('"linea1\nlinea2"');
  });

  it("emite solo headers cuando no hay filas", async () => {
    const csv = await rowsToCSVString(["a", "b"], []);
    expect(csv.slice(1)).toBe("a,b\n");
  });

  it("respeta el orden de headers", async () => {
    const csv = await rowsToCSVString(["b", "a"], [{ a: "1", b: "2" }]);
    expect(csv.slice(1).split("\n")[1]).toBe("2,1");
  });
});
```

- [ ] **Step 6.2: Correr (debe fallar)**

```bash
npm test -- tests/unit/csv.test.ts
```

- [ ] **Step 6.3: Implementar**

```ts
// src/lib/csv.ts
import { stringify } from "csv-stringify";
import type { FlatRow } from "@/lib/types";

const BOM = "﻿";

/** Versión string (útil para tests). */
export async function rowsToCSVString(headers: string[], rows: FlatRow[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const stringifier = stringify({ header: true, columns: headers, quoted_string: false });
    let out = "";
    stringifier.on("readable", () => {
      let chunk;
      while ((chunk = stringifier.read())) out += chunk;
    });
    stringifier.on("error", reject);
    stringifier.on("finish", () => resolve(BOM + out));
    for (const row of rows) {
      const ordered = Object.fromEntries(headers.map((h) => [h, row[h] ?? ""]));
      stringifier.write(ordered);
    }
    stringifier.end();
  });
}

/** Versión streaming para HTTP responses. */
export function rowsToCSVStream(headers: string[], rows: FlatRow[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(BOM));
      const stringifier = stringify({ header: true, columns: headers, quoted_string: false });
      stringifier.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      stringifier.on("end", () => controller.close());
      stringifier.on("error", (err) => controller.error(err));
      for (const row of rows) {
        const ordered = Object.fromEntries(headers.map((h) => [h, row[h] ?? ""]));
        stringifier.write(ordered);
      }
      stringifier.end();
    },
  });
}
```

- [ ] **Step 6.4: Correr (debe pasar)**

```bash
npm test -- tests/unit/csv.test.ts
```

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/csv.ts tests/unit/csv.test.ts
git commit -m "feat(csv): CSV string + stream serializers with UTF-8 BOM"
```

---

## Task 7: Next-cron calculator (`src/lib/cron.ts`)

**Branch:** `feat/07-cron`

**Files:**
- Create: `src/lib/cron.ts`
- Create: `tests/unit/cron.test.ts`

- [ ] **Step 7.1: Test**

```ts
// tests/unit/cron.test.ts
import { describe, it, expect } from "vitest";
import { nextRun } from "@/lib/cron";

describe("nextRun", () => {
  it("calcula el próximo disparo desde una fecha base", () => {
    const base = new Date("2026-05-17T10:30:00Z");
    expect(nextRun("0 */6 * * *", base).toISOString()).toBe("2026-05-17T12:00:00.000Z");
    expect(nextRun("0 9 * * *", base).toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });
});
```

- [ ] **Step 7.2: Correr (debe fallar)**

```bash
npm test -- tests/unit/cron.test.ts
```

- [ ] **Step 7.3: Implementar**

```ts
// src/lib/cron.ts
import parser from "cron-parser";

export function nextRun(expression: string, from: Date = new Date()): Date {
  const it = parser.parseExpression(expression, { currentDate: from, utc: true });
  return it.next().toDate();
}
```

- [ ] **Step 7.4: Correr (debe pasar)**

```bash
npm test -- tests/unit/cron.test.ts
```

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/cron.ts tests/unit/cron.test.ts
git commit -m "feat(cron): nextRun() to compute next cron firing time"
```

---

## Task 8: Auth (password + sesión) (`src/lib/auth.ts`)

**Branch:** `feat/08-auth`

**Files:**
- Create: `src/lib/auth.ts`
- Create: `tests/unit/auth.test.ts`

- [ ] **Step 8.1: Test**

```ts
// tests/unit/auth.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { verifyPassword, sessionOptions } from "@/lib/auth";

let hash: string;

beforeAll(async () => {
  hash = await bcrypt.hash("secreto123", 10);
  process.env.APP_PASSWORD_HASH = hash;
  process.env.SESSION_SECRET = "a".repeat(32);
});

describe("verifyPassword", () => {
  it("acepta el password correcto", async () => {
    expect(await verifyPassword("secreto123")).toBe(true);
  });
  it("rechaza el incorrecto", async () => {
    expect(await verifyPassword("malo")).toBe(false);
  });
});

describe("sessionOptions", () => {
  it("expone opciones httpOnly y cookieName", () => {
    expect(sessionOptions.cookieOptions?.httpOnly).toBe(true);
    expect(sessionOptions.cookieName).toBe("export-notion-session");
  });
});
```

- [ ] **Step 8.2: Correr (debe fallar)**

```bash
npm test -- tests/unit/auth.test.ts
```

- [ ] **Step 8.3: Implementar**

```ts
// src/lib/auth.ts
import bcrypt from "bcryptjs";
import type { SessionOptions } from "iron-session";

export interface SessionData {
  authenticated?: true;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "dev-only-do-not-use-in-prod-32-chars!",
  cookieName: "export-notion-session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  },
};

export async function verifyPassword(plain: string): Promise<boolean> {
  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) return false;
  try { return await bcrypt.compare(plain, hash); }
  catch { return false; }
}
```

- [ ] **Step 8.4: Correr (debe pasar)**

```bash
npm test -- tests/unit/auth.test.ts
```

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/auth.ts tests/unit/auth.test.ts
git commit -m "feat(auth): bcrypt password verification + iron-session config"
```

---

## Task 9: Cache (Upstash wrappers) (`src/lib/cache.ts`)

**Branch:** `feat/09-cache`

**Files:**
- Create: `src/lib/cache.ts`

> Sin tests unitarios (es un wrapper delgado de Upstash); se cubre en los tests de integración de sync/export con `ioredis-mock` no aplica para Upstash REST — usaremos un fake in-memory inyectable a través del export `__setClient`.

- [ ] **Step 9.1: Implementar**

```ts
// src/lib/cache.ts
import { Redis } from "@upstash/redis";
import type { FlatRow, CacheMeta, SyncStatus, SyncKind } from "@/lib/types";

const CACHE_KEY = "notion:cache:v1";
const CACHE_KEY_NEW = "notion:cache:v1:new";
const META_KEY = "notion:meta";
const STATUS_KEY = "notion:sync:status";
const LOCK_KEY = "notion:sync:lock";

let client: Redis | null = null;
function r(): Redis {
  if (!client) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return client;
}
/** Para tests: inyectar un cliente fake. */
export function __setClient(fake: Redis | null) { client = fake; }

// ---- Cache (hash) ----
export async function upsertRows(rows: { id: string; row: FlatRow }[], target: "current" | "new" = "current") {
  const key = target === "current" ? CACHE_KEY : CACHE_KEY_NEW;
  if (!rows.length) return;
  const pairs: Record<string, string> = {};
  for (const { id, row } of rows) pairs[id] = JSON.stringify(row);
  await r().hset(key, pairs);
}
export async function deleteRows(ids: string[], target: "current" | "new" = "current") {
  const key = target === "current" ? CACHE_KEY : CACHE_KEY_NEW;
  if (!ids.length) return;
  await r().hdel(key, ...ids);
}
export async function getAllRows(): Promise<FlatRow[]> {
  const all = (await r().hvals(CACHE_KEY)) as string[];
  return all.map((s) => JSON.parse(s));
}
export async function countRows(): Promise<number> {
  return await r().hlen(CACHE_KEY);
}
export async function clearNewCache() { await r().del(CACHE_KEY_NEW); }
export async function promoteNewCache() { await r().rename(CACHE_KEY_NEW, CACHE_KEY); }

// ---- Meta ----
export async function getMeta(): Promise<CacheMeta> {
  const v = await r().get<CacheMeta>(META_KEY);
  return v ?? { lastFullAt: null, lastIncrementalAt: null, count: 0 };
}
export async function setMeta(meta: CacheMeta) { await r().set(META_KEY, meta); }

// ---- Status ----
export async function getStatus(): Promise<SyncStatus> {
  const v = await r().get<SyncStatus>(STATUS_KEY);
  return v ?? { state: "idle", kind: null, done: 0, total: 0, startedAt: null, error: null, skipped: 0 };
}
export async function setStatus(s: SyncStatus) { await r().set(STATUS_KEY, s); }
export async function patchStatus(p: Partial<SyncStatus>) {
  const cur = await getStatus();
  await setStatus({ ...cur, ...p });
}

// ---- Lock ----
export async function acquireLock(ttlSec = 600): Promise<boolean> {
  const ok = await r().set(LOCK_KEY, "1", { nx: true, ex: ttlSec });
  return ok === "OK";
}
export async function releaseLock() { await r().del(LOCK_KEY); }
```

- [ ] **Step 9.2: Commit**

```bash
git add src/lib/cache.ts
git commit -m "feat(cache): Upstash wrappers for rows hash, meta, status, lock"
```

---

## Task 10: Cliente Notion con paginación + throttle (`src/lib/notion.ts`)

**Branch:** `feat/10-notion`

**Files:**
- Create: `src/lib/notion.ts`

- [ ] **Step 10.1: Implementar**

```ts
// src/lib/notion.ts
import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

const PAGE_SIZE = 100;
const REQS_PER_SECOND = 3;

let _client: Client | null = null;
function client(): Client {
  if (!_client) _client = new Client({ auth: process.env.NOTION_TOKEN! });
  return _client;
}
export function __setClient(c: Client | null) { _client = c; }

class Throttle {
  private last = 0;
  async wait() {
    const minGap = 1000 / REQS_PER_SECOND;
    const now = Date.now();
    const wait = Math.max(0, this.last + minGap - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }
}

export interface FetchOptions {
  /** ISO date string. Si está presente, se filtra por last_edited_time > since. */
  since?: string | null;
  /** Callback con (procesados, totalConocido) — totalConocido puede crecer en sucesivos batches. */
  onProgress?: (done: number, total: number) => void | Promise<void>;
}

export interface FetchResult {
  pages: PageObjectResponse[];
  /** Páginas archivadas detectadas (vienen con archived: true). */
  archivedIds: string[];
}

export async function fetchPages(opts: FetchOptions = {}): Promise<FetchResult> {
  const databaseId = process.env.NOTION_DATABASE_ID!;
  const throttle = new Throttle();
  const pages: PageObjectResponse[] = [];
  const archivedIds: string[] = [];
  let cursor: string | undefined = undefined;
  let done = 0;

  const filter = opts.since
    ? { timestamp: "last_edited_time" as const, last_edited_time: { after: opts.since } }
    : undefined;

  do {
    await throttle.wait();
    const resp = await retry(() =>
      client().databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: PAGE_SIZE,
        ...(filter ? { filter } : {}),
      }),
    );
    for (const r of resp.results) {
      if (!isFullPage(r)) continue;
      if (r.archived) archivedIds.push(r.id);
      else pages.push(r);
    }
    done = pages.length + archivedIds.length;
    await opts.onProgress?.(done, done + (resp.has_more ? PAGE_SIZE : 0));
    cursor = resp.has_more ? resp.next_cursor ?? undefined : undefined;
  } while (cursor);

  return { pages, archivedIds };
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e: any) {
      lastErr = e;
      const code = e?.status ?? e?.code;
      if (code === 401 || code === 404) throw e;
      // 429 con Retry-After
      const retryAfter = Number(e?.headers?.["retry-after"] ?? 0);
      const backoff = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** i;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 10.2: Commit**

```bash
git add src/lib/notion.ts
git commit -m "feat(notion): paginated query with 3 req/s throttle and retries"
```

---

## Task 11: Sync orquestador (`src/lib/sync.ts`)

**Branch:** `feat/11-sync`

**Files:**
- Create: `src/lib/sync.ts`

- [ ] **Step 11.1: Implementar**

```ts
// src/lib/sync.ts
import type { SyncKind } from "@/lib/types";
import { fetchPages } from "@/lib/notion";
import { flattenPage } from "@/lib/flatten";
import {
  acquireLock, releaseLock, patchStatus, setStatus,
  upsertRows, deleteRows, clearNewCache, promoteNewCache,
  getMeta, setMeta, countRows,
} from "@/lib/cache";

const OVERLAP_MS = 60_000;

export async function runSync(kind: SyncKind): Promise<{ ok: true } | { ok: false; reason: string }> {
  const locked = await acquireLock();
  if (!locked) return { ok: false, reason: "locked" };

  const startedAt = new Date().toISOString();
  await setStatus({ state: "running", kind, done: 0, total: 0, startedAt, error: null, skipped: 0 });

  try {
    if (kind === "full") await runFull();
    else await runIncremental();
    await patchStatus({ state: "idle", kind: null, startedAt: null });
    return { ok: true };
  } catch (e: any) {
    await patchStatus({ state: "error", error: e?.message ?? String(e) });
    return { ok: false, reason: e?.message ?? String(e) };
  } finally {
    await releaseLock();
  }
}

async function runFull(): Promise<void> {
  await clearNewCache();
  let skipped = 0;
  const { pages } = await fetchPages({
    onProgress: async (done, total) => { await patchStatus({ done, total }); },
  });
  const batch: { id: string; row: any }[] = [];
  for (const p of pages) {
    try { batch.push({ id: p.id, row: flattenPage(p) }); }
    catch { skipped++; }
  }
  if (batch.length) await upsertRows(batch, "new");
  await promoteNewCache();
  const now = new Date().toISOString();
  await setMeta({ lastFullAt: now, lastIncrementalAt: now, count: await countRows() });
  await patchStatus({ skipped });
}

async function runIncremental(): Promise<void> {
  const meta = await getMeta();
  const since = meta.lastIncrementalAt
    ? new Date(new Date(meta.lastIncrementalAt).getTime() - OVERLAP_MS).toISOString()
    : null;

  let skipped = 0;
  const { pages, archivedIds } = await fetchPages({
    since,
    onProgress: async (done, total) => { await patchStatus({ done, total }); },
  });
  const batch: { id: string; row: any }[] = [];
  for (const p of pages) {
    try { batch.push({ id: p.id, row: flattenPage(p) }); }
    catch { skipped++; }
  }
  if (batch.length) await upsertRows(batch);
  if (archivedIds.length) await deleteRows(archivedIds);
  await setMeta({ ...meta, lastIncrementalAt: new Date().toISOString(), count: await countRows() });
  await patchStatus({ skipped });
}
```

- [ ] **Step 11.2: Commit**

```bash
git add src/lib/sync.ts
git commit -m "feat(sync): hybrid runSync orchestrator (full with atomic promote + incremental)"
```

---

## Task 12: Integration test — sync incremental + full

**Branch:** `test/12-sync-integration`

**Files:**
- Create: `tests/integration/sync.test.ts`
- Create: `tests/fixtures/fakeRedis.ts`
- Create: `tests/fixtures/fakeNotion.ts`

- [ ] **Step 12.1: Fake Redis in-memory que imita la API de Upstash usada**

```ts
// tests/fixtures/fakeRedis.ts
export class FakeRedis {
  private kv = new Map<string, any>();
  private hashes = new Map<string, Map<string, string>>();

  async get<T>(k: string): Promise<T | null> { return (this.kv.get(k) as T) ?? null; }
  async set(k: string, v: any, opts?: { nx?: boolean; ex?: number }) {
    if (opts?.nx && this.kv.has(k)) return null;
    this.kv.set(k, v);
    return "OK";
  }
  async del(...keys: string[]) { let n = 0; for (const k of keys) { if (this.kv.delete(k)) n++; this.hashes.delete(k); } return n; }
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
```

- [ ] **Step 12.2: Fake Notion client**

```ts
// tests/fixtures/fakeNotion.ts
import { page, titleProp, dateProp } from "./notion-pages/sample";

export function makeFakeClient(initialPages: any[], opts: { archivedIds?: string[] } = {}) {
  return {
    databases: {
      async query(args: any) {
        const cursor = Number(args.start_cursor ?? 0);
        const slice = initialPages.slice(cursor, cursor + args.page_size);
        const next = cursor + slice.length;
        return {
          results: slice,
          has_more: next < initialPages.length,
          next_cursor: next < initialPages.length ? String(next) : null,
        };
      },
    },
  } as any;
}

export function makePage(id: string, title: string, when: string, archived = false) {
  return page({ Title: titleProp(title), When: dateProp(when) }, { id, archived });
}
```

- [ ] **Step 12.3: Test**

```ts
// tests/integration/sync.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/columns", () => ({
  COLUMNS: [{ notion: "Title", csv: "Nombre" }, { notion: "When" }],
  csvHeaders: () => ["Nombre", "When"],
}));

import { FakeRedis } from "../fixtures/fakeRedis";
import { makeFakeClient, makePage } from "../fixtures/fakeNotion";
import { __setClient as setRedis } from "@/lib/cache";
import { __setClient as setNotion } from "@/lib/notion";
import { runSync } from "@/lib/sync";
import * as cache from "@/lib/cache";

beforeEach(() => {
  process.env.NOTION_DATABASE_ID = "db-test";
  process.env.NOTION_TOKEN = "tok";
  setRedis(new FakeRedis() as any);
});

describe("runSync full", () => {
  it("escribe en cache nuevo, promueve atómico, actualiza meta", async () => {
    const pages = [
      makePage("a", "A", "2026-01-01"),
      makePage("b", "B", "2026-02-01"),
    ];
    setNotion(makeFakeClient(pages) as any);
    const r = await runSync("full");
    expect(r).toEqual({ ok: true });
    const rows = await cache.getAllRows();
    expect(rows).toHaveLength(2);
    const meta = await cache.getMeta();
    expect(meta.count).toBe(2);
    expect(meta.lastFullAt).not.toBeNull();
  });

  it("dos syncs simultáneos: el segundo recibe locked", async () => {
    setNotion(makeFakeClient([]) as any);
    const [a, b] = await Promise.all([runSync("full"), runSync("full")]);
    const oks = [a, b].filter((x) => x.ok).length;
    expect(oks).toBe(1);
  });
});

describe("runSync incremental", () => {
  it("upsert y delete por archived", async () => {
    setNotion(makeFakeClient([
      makePage("a", "A", "2026-01-01"),
      makePage("b", "B", "2026-02-01"),
    ]) as any);
    await runSync("full");

    setNotion(makeFakeClient([
      makePage("b", "B2", "2026-02-15"),       // editada
      makePage("c", "C",  "2026-03-01"),       // nueva
      makePage("a", "A",  "2026-01-01", true), // archivada
    ]) as any);
    const r = await runSync("incremental");
    expect(r).toEqual({ ok: true });

    const rows = await cache.getAllRows();
    expect(rows).toHaveLength(2);
    const titles = rows.map((r: any) => r.Nombre).sort();
    expect(titles).toEqual(["B2", "C"]);
  });
});
```

- [ ] **Step 12.4: Correr (debe pasar)**

```bash
npm test -- tests/integration/sync.test.ts
```

- [ ] **Step 12.5: Commit**

```bash
git add tests/
git commit -m "test(sync): integration tests for full + incremental + lock contention"
```

---

## Task 13: API route `/api/login`

**Branch:** `feat/13-api-login`

**Files:**
- Create: `src/app/api/login/route.ts`

- [ ] **Step 13.1: Implementar**

```ts
// src/app/api/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getIronSession } from "iron-session";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { sessionOptions, verifyPassword, type SessionData } from "@/lib/auth";

const limiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  prefix: "notion:ratelimit:login",
});

export async function POST(req: NextRequest) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await limiter.limit(ip);
  if (!success) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || !(await verifyPassword(password))) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.authenticated = true;
  await session.save();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.destroy();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 13.2: Commit**

```bash
git add src/app/api/login/route.ts
git commit -m "feat(api): /api/login with bcrypt + iron-session + Upstash rate limit"
```

---

## Task 14: Middleware de auth (`src/middleware.ts`)

**Branch:** `feat/14-middleware`

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 14.1: Implementar**

```ts
// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth";

const PROTECTED = ["/api/export", "/api/sync/status"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /api/sync acepta cookie de usuario O Bearer del cron — manejado en la route.
  if (!PROTECTED.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req.cookies as any, sessionOptions);
  if (!session.authenticated) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return res;
}

export const config = {
  matcher: ["/api/export/:path*", "/api/sync/status"],
};
```

- [ ] **Step 14.2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): gate protected API routes with iron-session"
```

---

## Task 15: API `/api/sync` (cron o user-triggered)

**Branch:** `feat/15-api-sync`

**Files:**
- Create: `src/app/api/sync/route.ts`

- [ ] **Step 15.1: Implementar**

```ts
// src/app/api/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { runSync } from "@/lib/sync";
import type { SyncKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min (Vercel pro)

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && bearer === process.env.CRON_SECRET) return true;
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  return Boolean(session.authenticated);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const kind = (req.nextUrl.searchParams.get("kind") ?? "incremental") as SyncKind;
  if (kind !== "incremental" && kind !== "full") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  // No await: dispara en background y responde 202.
  void runSync(kind);
  return NextResponse.json({ accepted: true, kind }, { status: 202 });
}
```

- [ ] **Step 15.2: Commit**

```bash
git add src/app/api/sync/route.ts
git commit -m "feat(api): /api/sync accepts cron bearer or session, runs async"
```

---

## Task 16: API `/api/sync/status`

**Branch:** `feat/16-api-sync-status`

**Files:**
- Create: `src/app/api/sync/status/route.ts`

- [ ] **Step 16.1: Implementar**

```ts
// src/app/api/sync/status/route.ts
import { NextResponse } from "next/server";
import { getStatus, getMeta } from "@/lib/cache";
import { nextRun } from "@/lib/cron";

export const dynamic = "force-dynamic";

const CRON_INCREMENTAL = "0 */6 * * *";
const CRON_FULL = "0 9 * * *";

export async function GET() {
  const now = new Date();
  const [status, meta] = await Promise.all([getStatus(), getMeta()]);
  return NextResponse.json({
    status, meta,
    next: {
      incremental: nextRun(CRON_INCREMENTAL, now).toISOString(),
      full: nextRun(CRON_FULL, now).toISOString(),
    },
  });
}
```

- [ ] **Step 16.2: Commit**

```bash
git add src/app/api/sync/status/route.ts
git commit -m "feat(api): /api/sync/status returns status + meta + next cron fires"
```

---

## Task 17: API `/api/export`

**Branch:** `feat/17-api-export`

**Files:**
- Create: `src/app/api/export/route.ts`

- [ ] **Step 17.1: Implementar**

```ts
// src/app/api/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAllRows, countRows } from "@/lib/cache";
import { filterByDateRange } from "@/lib/filter";
import { rowsToCSVStream } from "@/lib/csv";
import { csvHeaders, COLUMNS } from "@/lib/columns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (from && !ISO_DATE.test(from)) return NextResponse.json({ error: "bad_from" }, { status: 400 });
  if (to && !ISO_DATE.test(to)) return NextResponse.json({ error: "bad_to" }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ error: "from_after_to" }, { status: 400 });

  if ((await countRows()) === 0) {
    return NextResponse.json({ error: "no_data", message: "Aún no hay datos. Corre el primer sync." }, { status: 503 });
  }

  const headers = csvHeaders();
  const all = await getAllRows();
  const filtered = filterByDateRange(all, from, to, process.env.DATE_COLUMN!);

  // Re-resolver el nombre CSV de DATE_COLUMN para advertir si no está en whitelist
  const dateColInWhitelist = COLUMNS.some((c) => c.notion === process.env.DATE_COLUMN);
  if (!dateColInWhitelist) {
    return NextResponse.json({ error: "date_column_not_in_whitelist" }, { status: 500 });
  }

  const stream = rowsToCSVStream(headers, filtered);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const fname = `export-${from ?? "all"}-${to ?? "all"}-${stamp}.csv`;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 17.2: Commit**

```bash
git add src/app/api/export/route.ts
git commit -m "feat(api): /api/export streams filtered CSV, validates dates"
```

---

## Task 18: UI (`src/app/page.tsx`)

**Branch:** `feat/18-ui`

**Files:**
- Modify/replace: `src/app/page.tsx`

> Página única con 3 estados (no autenticado / idle / running). Cliente puro (`"use client"`). Reemplaza el placeholder generado por `create-next-app`.

- [ ] **Step 18.1: Implementar**

```tsx
// src/app/page.tsx
"use client";
import { useEffect, useState } from "react";

type Status = {
  status: { state: "idle"|"running"|"error"; kind: "incremental"|"full"|null; done: number; total: number; error: string | null; skipped: number; };
  meta: { lastFullAt: string | null; lastIncrementalAt: string | null; count: number; };
  next: { incremental: string; full: string; };
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  return `hace ${h} h`;
}
function fmtCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [, setTick] = useState(0);

  async function loadStatus() {
    const r = await fetch("/api/sync/status");
    if (r.status === 401) { setAuthed(false); return; }
    setAuthed(true);
    setStatus(await r.json());
  }
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    if (!authed) return;
    const i = setInterval(() => setTick((x) => x + 1), 1000);
    const j = setInterval(() => loadStatus(), status?.status.state === "running" ? 2000 : 30000);
    return () => { clearInterval(i); clearInterval(j); };
  }, [authed, status?.status.state]);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setLoginErr(null);
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    if (r.ok) { setPassword(""); loadStatus(); }
    else setLoginErr(r.status === 429 ? "Demasiados intentos, espera 15 min." : "Contraseña incorrecta.");
  }

  async function trigger(kind: "incremental" | "full") {
    await fetch(`/api/sync?kind=${kind}`, { method: "POST" });
    loadStatus();
  }

  function downloadHref() {
    const p = new URLSearchParams();
    if (from) p.set("from", from); if (to) p.set("to", to);
    return `/api/export?${p.toString()}`;
  }

  if (authed === null) return <main className="p-8">Cargando…</main>;

  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <form onSubmit={login} className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold">ExportNotion</h1>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 className="w-full border rounded px-3 py-2" placeholder="Contraseña" autoFocus />
          {loginErr && <p className="text-sm text-red-600">{loginErr}</p>}
          <button className="w-full bg-black text-white rounded py-2">Entrar</button>
        </form>
      </main>
    );
  }

  const running = status?.status.state === "running";

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold">ExportNotion</h1>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-medium">Última sincronización</h2>
        <p>Full: {fmtAgo(status?.meta.lastFullAt ?? null)}</p>
        <p>Incremental: {fmtAgo(status?.meta.lastIncrementalAt ?? null)}</p>
        <p>Registros en cache: {status?.meta.count ?? 0}</p>
      </section>

      {running ? (
        <section className="border rounded p-4">
          <h2 className="font-medium mb-2">Sync en progreso ({status?.status.kind})</h2>
          <p>{status?.status.done} / {status?.status.total}</p>
          {status?.status.skipped ? <p className="text-sm text-amber-700">Omitidos: {status.status.skipped}</p> : null}
        </section>
      ) : (
        <section className="border rounded p-4 space-y-2">
          <h2 className="font-medium">Próximas sincronizaciones</h2>
          <p>Incremental en {status ? fmtCountdown(status.next.incremental) : "—"}</p>
          <p>Full en {status ? fmtCountdown(status.next.full) : "—"}</p>
          <div className="flex gap-2 pt-2">
            <button onClick={() => trigger("incremental")} className="bg-black text-white rounded px-3 py-2">Refrescar incremental</button>
            <button onClick={() => trigger("full")} className="border rounded px-3 py-2">Full</button>
          </div>
        </section>
      )}

      <section className="border rounded p-4 space-y-3">
        <h2 className="font-medium">Descargar CSV</h2>
        <div className="flex gap-3">
          <label className="flex-1">Desde
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block w-full border rounded px-2 py-1" />
          </label>
          <label className="flex-1">Hasta
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block w-full border rounded px-2 py-1" />
          </label>
        </div>
        <a href={downloadHref()} className="inline-block bg-black text-white rounded px-3 py-2">Descargar</a>
      </section>
    </main>
  );
}
```

- [ ] **Step 18.2: Build local**

```bash
npm run build
```

Esperado: build OK.

- [ ] **Step 18.3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(ui): login + status + download UI with live countdowns"
```

---

## Task 19: Vercel config (crons + headers)

**Branch:** `chore/19-vercel-config`

**Files:**
- Create: `vercel.json`

- [ ] **Step 19.1: Implementar**

```json
{
  "crons": [
    { "path": "/api/sync?kind=incremental", "schedule": "0 */6 * * *" },
    { "path": "/api/sync?kind=full",        "schedule": "0 9 * * *" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

- [ ] **Step 19.2: Commit**

```bash
git add vercel.json
git commit -m "chore(vercel): cron jobs (6h incremental + daily full) + security headers"
```

---

## Task 20: Smoke E2E (Playwright)

**Branch:** `test/20-e2e-smoke`

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/smoke.spec.ts`

> Solo verifica el flujo de login. La descarga real requiere Notion + Redis reales o mocks complejos; lo dejamos como prueba manual documentada en README.

- [ ] **Step 20.1: Configurar Playwright**

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
```

- [ ] **Step 20.2: Test**

```ts
// tests/e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";

test("login screen renders and rejects wrong password", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Contraseña")).toBeVisible();
  await page.getByPlaceholder("Contraseña").fill("incorrecto");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/Contraseña incorrecta|Demasiados intentos/)).toBeVisible();
});
```

- [ ] **Step 20.3: Instalar navegadores**

```bash
npx playwright install chromium
```

- [ ] **Step 20.4: Commit**

```bash
git add playwright.config.ts tests/e2e/smoke.spec.ts
git commit -m "test(e2e): smoke test for login screen"
```

---

## Task 21: README operativo

**Branch:** `docs/21-readme`

**Files:**
- Modify: `README.md`

- [ ] **Step 21.1: Reemplazar README con guía operativa**

```md
# ExportNotion

Webapp interna para descargar contenido de una base de Notion como CSV, con filtro de rango de fechas y autenticación por password compartido.

## Stack

Next.js 15 (App Router, TS) · Upstash Redis · `@notionhq/client` · Tailwind · Vitest + Playwright

## Setup local

1. Copia `.env.example` a `.env.local` y rellena las variables.
2. Genera el hash bcrypt del password compartido:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "MI-PASSWORD"
   ```
3. Edita `src/lib/columns.ts` con la whitelist real de propiedades.
4. Ajusta `DATE_COLUMN` al nombre exacto de la propiedad fecha en tu base.
5. ```bash
   npm install
   npm run dev
   ```

## Tests

```bash
npm test                # unit + integration
npm run test:e2e        # Playwright (requiere dev server)
```

## Deploy a Vercel

1. Conecta el repo a Vercel.
2. Configura todas las env vars del `.env.example` en Project Settings.
3. Push a `main` → Vercel deploya y activa los crons del `vercel.json`.
4. **Primer sync:** después del primer deploy, entra a la app, haz login y aprieta "Full". Sin ese primer sync el `/api/export` responde 503.

## Operación

- **Cron incremental**: cada 6h.
- **Cron full**: diario 09:00 UTC (03:00 CDMX).
- **Botón "Full"**: usa cuando sospeches drift (borrados no detectados).
- **Logs de sync**: visibles en la UI (estado actual y último error).

## Seguridad

- Password compartido (bcrypt) + cookie httpOnly firmada.
- Rate limit 5 intentos / 15 min por IP.
- Whitelist server-side: el cliente nunca puede pedir columnas fuera de la lista.
```

- [ ] **Step 21.2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, deploy, and operation instructions"
```

---

## Task 22: Verificación final

**Branch:** `chore/22-final-verification` (solo si hay cambios; si todo pasa sin tocar nada, esta tarea se ejecuta directamente sobre `main`)

- [ ] **Step 22.1: Todos los tests pasan**

```bash
npm test
```

Esperado: todos verdes.

- [ ] **Step 22.2: Build limpio**

```bash
npm run build
```

Esperado: sin errores TS ni warnings de Next.

- [ ] **Step 22.3: Verificación manual local**

Con `.env.local` poblado y la whitelist editada:

```bash
npm run dev
```

Pasos:
1. Abrir `http://localhost:3000` → ver pantalla de login.
2. Password incorrecto → mensaje de error.
3. Password correcto → ver estado con timers.
4. Click "Full" → ver barra de progreso, esperar a `idle`.
5. Seleccionar rango de fechas → "Descargar" → verificar CSV bajado (abre en Excel sin problema de encoding).

- [ ] **Step 22.4: Push final**

```bash
git push origin main
```

---

## Notas de implementación

- **Vercel free tier:** `maxDuration` está en 60s por route (export) y 300s (sync). El sync incremental siempre cabe; el full tarda ~40s para 11k. Si en el primer deploy el full no termina dentro del tiempo, el lock libera por TTL y el siguiente cron retoma — pero conviene Pro plan para mayor margen.
- **`columns.ts` y `DATE_COLUMN`:** ambos los define el usuario antes del primer deploy productivo. Sin la whitelist correcta el cache se llena con filas vacías.
- **Rate limit de Notion:** el throttle interno asegura ≤ 3 req/s, pero Upstash y Vercel también imponen sus límites — el plan free de Upstash es suficiente para esta carga.
