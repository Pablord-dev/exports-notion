import bcrypt from "bcryptjs";

export { sessionOptions, type SessionData } from "./session";

export async function verifyPassword(plain: string): Promise<boolean> {
  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
