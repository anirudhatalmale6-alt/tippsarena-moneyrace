/**
 * Create (or reset) a dashboard login.
 *
 *   node scripts/create-admin.ts "trifun@example.com" "ein-langes-passwort" "Trifun"
 *
 * Run on the server. The password is hashed with bcrypt before it is stored and
 * is never written to the log.
 */
import { pool } from "../lib/db.ts";
import { createAdmin } from "../lib/auth.ts";
import { log } from "../lib/log.ts";

const [email, password, name] = process.argv.slice(2);

if (!email || !password) {
  console.error(
    'Aufruf: node scripts/create-admin.ts "email" "passwort" "Name"',
  );
  process.exit(1);
}

try {
  const id = await createAdmin(email, password, name ?? email);
  log.info(`admin #${id} ready for ${email}`);
} catch (err) {
  log.error("could not create the admin", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
