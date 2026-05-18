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
