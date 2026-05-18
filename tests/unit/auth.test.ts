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
