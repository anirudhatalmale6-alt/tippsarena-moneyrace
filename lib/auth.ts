/**
 * Admin authentication (spec §35).
 *
 * A signed, httpOnly cookie. No third-party session library, because the whole
 * of what is needed is "this browser proved it knows an admin password less
 * than N days ago", and a hand-rolled HMAC of a user id is easier to audit than
 * a framework.
 *
 * The password itself is never stored - only a bcrypt hash - and the cookie
 * carries no password material at all.
 */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { one, query } from "./db.ts";
import { log } from "./log.ts";

export const SESSION_COOKIE = "ta_admin";
const MAX_AGE_SECONDS = 7 * 24 * 3600;

export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
}

/**
 * The signing secret.
 *
 * Generated and stored once if it is not configured, so a fresh install works
 * without a manual step - but ADMIN_SESSION_SECRET in the environment wins, so
 * a real deployment can keep it out of the database entirely.
 */
async function secret(): Promise<string> {
  const fromEnv = process.env.ADMIN_SESSION_SECRET;
  if (fromEnv) return fromEnv;

  const stored = await one<{ value: string }>(
    "SELECT value #>> '{}' AS value FROM settings WHERE key = 'admin_session_secret'",
  );
  if (stored?.value) return stored.value;

  const generated = randomBytes(32).toString("hex");
  await query(
    `INSERT INTO settings (key, value, description)
     VALUES ('admin_session_secret', $1::jsonb, 'Intern - nicht ändern')
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(generated)],
  );
  log.warn("generated a new admin session secret - existing logins are now invalid");
  return generated;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

export async function createSessionToken(userId: number): Promise<string> {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload, await secret())}`;
}

/** Returns the user id, or null for anything that does not verify. */
export async function readSessionToken(
  token: string | undefined,
): Promise<number | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawId, rawExpires, signature] = parts;

  const expected = sign(`${rawId}.${rawExpires}`, await secret());
  // Constant time, so the comparison cannot be used to guess a signature.
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const expires = Number(rawExpires);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;

  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

export async function findAdmin(id: number): Promise<AdminUser | null> {
  return one<AdminUser>(
    `SELECT id, email, name, role, is_active FROM admin_users
      WHERE id = $1 AND is_active`,
    [id],
  );
}

/**
 * Check an email and password.
 *
 * Returns null for a wrong password AND for an unknown email, and does the
 * bcrypt work either way, so the response time does not say which it was.
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<AdminUser | null> {
  const row = await one<AdminUser & { password_hash: string }>(
    `SELECT id, email, name, role, is_active, password_hash FROM admin_users
      WHERE lower(email) = lower($1)`,
    [email],
  );

  // A hash of nothing, so an unknown email costs the same as a known one.
  const hash = row?.password_hash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi";
  const ok = await bcrypt.compare(password, hash);

  if (!row || !ok || !row.is_active) {
    log.warn(`failed admin login for ${email}`);
    return null;
  }

  await query("UPDATE admin_users SET last_login_at = now() WHERE id = $1", [row.id]);
  const { password_hash, ...user } = row;
  return user;
}

export async function createAdmin(
  email: string,
  password: string,
  name: string,
): Promise<number> {
  if (password.length < 10) {
    throw new Error("Das Passwort muss mindestens 10 Zeichen haben");
  }
  const hash = await bcrypt.hash(password, 12);
  const rows = await query<{ id: number }>(
    `INSERT INTO admin_users (email, password_hash, name) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                       name = EXCLUDED.name,
                                       is_active = TRUE
     RETURNING id`,
    [email.toLowerCase(), hash, name],
  );
  return rows[0].id;
}
