/**
 * Every secret and every environment-specific value, in one place.
 *
 * Nothing here is ever committed: the values come from .env (see .env.example).
 * Spec §35 - the bot token and the football key must never reach a browser, so
 * this module is imported by the server processes only.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Minimal .env reader. No dependency, and it does not overwrite a real env var. */
function loadEnvFile(): void {
  let text: string;
  try {
    text = readFileSync(join(ROOT, ".env"), "utf8");
  } catch {
    return; // running with real environment variables, which is normal in prod
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  botToken: required("TELEGRAM_BOT_TOKEN"),
  footballKey: optional("FOOTBALL_API_KEY"),
  footballHost: optional("FOOTBALL_API_HOST", "v3.football.api-sports.io"),
  adminPort: Number(optional("ADMIN_PORT", "3200")),
  adminSessionSecret: optional("ADMIN_SESSION_SECRET", ""),
  /** Written into every deep link. Read from the DB at runtime where possible. */
  botUsername: optional("BOT_USERNAME", "TippsArenaMoneyrace_bot"),
  logLevel: optional("LOG_LEVEL", "info"),
};

export const isProduction = optional("NODE_ENV") === "production";
