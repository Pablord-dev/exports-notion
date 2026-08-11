// Tabla users contra memory-store: MISMOS casos que db.pg.test.ts corre contra
// Postgres real.
import { describe, it, beforeEach } from "vitest";
import { __setStore } from "@/lib/db";
import { newMemoryStore } from "@/lib/memory-store";
import { runUserAssertions } from "../fixtures/userCases";
import * as db from "@/lib/db";

describe("users sobre memory-store", () => {
  beforeEach(() => { __setStore(newMemoryStore()); });

  it("pasa los casos compartidos de usuarios", async () => {
    await runUserAssertions(db);
  });
});
