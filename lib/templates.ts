/**
 * Message templates (spec §31).
 *
 * Every word a user reads comes from the database, so the operator can rewrite
 * any of it without a developer. Two rules make that safe to hand over:
 *
 *  - An unknown {placeholder} is left exactly as typed. A typo in the dashboard
 *    then shows up as visible text in a test message instead of throwing at
 *    2am while an announcement is going out.
 *  - A missing template falls back to its key rather than an empty message, so
 *    a deleted row is obvious rather than silent.
 */
import { one, query } from "./db.ts";
import { log } from "./log.ts";

export interface TemplateButton {
  text: string;
  /** one of: menu | channel | check_membership | deeplink | url */
  action?: string;
  url?: string;
  data?: string;
}

export interface Template {
  key: string;
  name: string;
  body: string;
  buttons: TemplateButton[];
  parse_mode: string;
}

export type Vars = Record<string, string | number | null | undefined>;

/** Replace {name} with the value, and leave anything unknown alone. */
export function fill(body: string, vars: Vars): string {
  return body.replace(/\{([a-z0-9_]+)\}/gi, (whole, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return whole;
    return String(value);
  });
}

const cache = new Map<string, { at: number; template: Template }>();
const CACHE_MS = 30_000; // long enough to matter, short enough that an edit shows up

export async function getTemplate(key: string): Promise<Template> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.template;

  const row = await one<Template>(
    `SELECT key, name, body, buttons, parse_mode FROM message_templates
      WHERE key = $1`,
    [key],
  );

  const template: Template = row ?? {
    key,
    name: key,
    body: `⚠️ Vorlage "${key}" fehlt.`,
    buttons: [],
    parse_mode: "HTML",
  };
  if (!row) log.warn(`message template "${key}" is missing`);

  cache.set(key, { at: Date.now(), template });
  return template;
}

export function clearTemplateCache(): void {
  cache.clear();
}

export async function render(
  key: string,
  vars: Vars = {},
): Promise<{ text: string; buttons: TemplateButton[]; parseMode: string }> {
  const template = await getTemplate(key);
  return {
    text: fill(template.body, vars),
    buttons: (template.buttons ?? []).map((b) => ({
      ...b,
      text: fill(b.text, vars),
      url: b.url ? fill(b.url, vars) : undefined,
    })),
    parseMode: template.parse_mode || "HTML",
  };
}

export async function listTemplates(): Promise<Template[]> {
  return query<Template>(
    `SELECT key, name, body, buttons, parse_mode FROM message_templates
      ORDER BY name`,
  );
}

export async function saveTemplate(
  key: string,
  body: string,
  buttons: TemplateButton[],
): Promise<void> {
  await query(
    `UPDATE message_templates
        SET body = $2, buttons = $3, updated_at = now()
      WHERE key = $1`,
    [key, body, JSON.stringify(buttons)],
  );
  cache.delete(key);
}

// --------------------------------------------------------------- formatting
/** German money: 250 € , 99,50 € - never "250.00 EUR". */
export function money(amount: number, currency = "EUR"): string {
  const symbol = currency === "EUR" ? "€" : currency;
  const text = Number(amount).toLocaleString("de-DE", {
    minimumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${text} ${symbol}`;
}

/** German date and time, in the operator's timezone. */
export function when(
  date: Date | string | null,
  timeZone = "Europe/Berlin",
): string {
  if (!date) return "-";
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(value);
}

/**
 * A wall-clock time typed by the operator, turned into a real instant.
 *
 * A <input type="datetime-local"> gives "2026-08-29T15:25" with no timezone.
 * He means 15:25 in Berlin. Reading that as UTC would move every lock by two
 * hours in summer and one in winter - which is the difference between locking
 * before kick-off and locking after it.
 *
 * The trick: pretend the string is UTC, ask what that instant looks like in the
 * target zone, and shift by the difference. One pass is exact except for the
 * hour a DST change skips or repeats, where the offset is genuinely ambiguous.
 */
export function zonedToUtc(local: string, timeZone = "Europe/Berlin"): Date | null {
  if (!local) return null;
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  const asIfUtc = new Date(`${withSeconds}Z`);
  if (Number.isNaN(asIfUtc.getTime())) return null;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // h23 rather than hour12:false - some runtimes render midnight as "24".
      hourCycle: "h23",
    })
      .formatToParts(asIfUtc)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const shown = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = shown - asIfUtc.getTime();
  return new Date(asIfUtc.getTime() - offset);
}

/** The reverse, for filling a datetime-local box from a stored instant. */
export function utcToZonedInput(
  date: Date | string | null,
  timeZone = "Europe/Berlin",
): string {
  if (!date) return "";
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Telegram's HTML parse mode only forgives these three if they are escaped. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
