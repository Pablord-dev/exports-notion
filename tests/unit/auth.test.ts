import { describe, it, expect } from "vitest";
import { sessionOptions } from "@/lib/auth";

describe("sessionOptions", () => {
  it("expone opciones httpOnly y cookieName", () => {
    expect(sessionOptions.cookieOptions?.httpOnly).toBe(true);
    expect(sessionOptions.cookieName).toBe("export-notion-session");
  });
});
