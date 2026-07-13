// Reportes contra memory-store: MISMOS casos que db.pg.test.ts corre contra
// Postgres real — si ambos pasan, el stub es fiel al SQL (lección D1).
import { describe, it, beforeEach } from "vitest";
import { __setStore } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";
import { runReportAssertions } from "../fixtures/reportCases";
import * as db from "@/lib/db";

describe("reportes sobre memory-store", () => {
  beforeEach(() => {
    delete process.env.DATE_COLUMN; // usa el default "Hora de creación", igual que el caso PG
    __setStore(newMemoryStore());
  });

  it("pasa los casos compartidos de reportes", async () => {
    await runReportAssertions(db);
  });
});
