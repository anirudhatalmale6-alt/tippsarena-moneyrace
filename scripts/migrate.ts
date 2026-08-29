/**
 * Migration runner.
 *
 * Applies every .sql file in db/migrations in name order, once, inside a
 * transaction, and records it. Deliberately tiny and dependency-free: this has
 * to work on a plain Postgres and on Supabase without a toolchain.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/config.ts";
import { pool, query } from "../lib/db.ts";
import { log } from "../lib/log.ts";

const DIR = join(ROOT, "db", "migrations");

async function main(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await query<{ name: string }>("SELECT name FROM schema_migrations")).map(
      (r) => r.name,
    ),
  );

  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(DIR, file), "utf8");
    const client = await pool.connect();
    try {
      // The file brings its own BEGIN/COMMIT; the bookkeeping insert goes in
      // the same connection so a failed migration is never recorded as done.
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        file,
      ]);
      log.info(`applied ${file}`);
      count += 1;
    } catch (err) {
      log.error(`FAILED ${file} - nothing from it was applied`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  log.info(count ? `${count} migration(s) applied` : "already up to date");
  await pool.end();
}

main().catch((err) => {
  log.error("migration run failed", err);
  process.exit(1);
});
