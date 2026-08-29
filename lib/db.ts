/**
 * The database. One pool for the whole process.
 *
 * Everything goes through `query` or `tx` so there is a single place that logs a
 * slow or failing statement, and a single place to change if this ever moves to
 * Supabase (it would not need to change: the URL is the only difference).
 */
import pg from "pg";
import { config } from "./config.ts";
import { log } from "./log.ts";

// A NUMERIC comes back from pg as a string by default, because it can hold more
// than a JS number can. Prize money never will, and having "250.00" behave like
// a number everywhere it is displayed or compared is worth more here.
pg.types.setTypeParser(1700, (value: string) => Number(value));
// BIGINT (int8). Telegram ids are the reason this matters: they are int8 in the
// schema and they must compare as numbers, not as strings.
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => log.error("idle postgres client error", err));

export async function query<T = any>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const started = Date.now();
  try {
    const result = await pool.query(text, params as any[]);
    const ms = Date.now() - started;
    if (ms > 500) log.warn(`slow query ${ms}ms: ${text.slice(0, 120)}`);
    return result.rows as T[];
  } catch (err) {
    log.error(`query failed: ${text.slice(0, 200)}`, err);
    throw err;
  }
}

/** The first row, or null. For the very common "fetch one by id". */
export async function one<T = any>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length ? rows[0] : null;
}

/**
 * Run a set of statements in a transaction.
 *
 * Anything that changes a score, a rank or a prize goes through here. A partial
 * scoring run is worse than none: a leaderboard that is half old and half new
 * looks correct and is not.
 */
export async function tx<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Read one operator setting, with a fallback if it was never set. */
export async function getSetting<T = any>(
  key: string,
  fallback: T | null = null,
): Promise<T | null> {
  const row = await one<{ value: T }>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  if (!row || row.value === null) return fallback;
  return row.value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function closePool(): Promise<void> {
  await pool.end();
}
