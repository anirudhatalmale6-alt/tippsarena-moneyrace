/**
 * A queued announcement must still be true when it comes due.
 *
 * The regression this file exists for: giveaway 57 was published on 29 Aug with
 * an end time of 30 Aug 11:17, which queued a Tippschluss reminder for 10:17.
 * The winner was drawn and announced on the 29th. The reminder came due anyway
 * and posted "Noch 1 Stunde! Deine Tipps abgeben!" into his channel - for a
 * giveaway, which has no tips, that had been finished for 22 hours. Nobody
 * pressed anything.
 *
 * NOTHING LEAVES THIS PROCESS, and nothing here calls the sender. Running the
 * worker's send loop in a test would mark HIS real due announcements as sent
 * while the interceptor quietly swallowed them - a worse bug than the one being
 * tested. So the loop is taken in two halves that can be asked separately:
 * dueNotifications() for what it claims, notificationStillTrue() for what it
 * then decides. A transformer is still installed on the shared Api, as the
 * proof that nothing was sent rather than as a delivery mechanism.
 *
 * The live worker runs beside this file and shares the database, so:
 *   - almost every notification row here is due an HOUR IN THE FUTURE, and the
 *     worker claims nothing that is not yet due;
 *   - the one row that must be due in the past is a finished giveaway's
 *     reminder, which the deployed worker reaches the same verdict on and
 *     refuses. It is safe by what it is, not by timing.
 * Everything it makes, it deletes - the file must give the same answer twice.
 */
import { api } from "../worker/announce.ts";
import { dueNotifications } from "../worker/index.ts";
import {
  cancelPendingNotifications,
  notificationApplies,
  notificationStillTrue,
} from "../lib/announcements.ts";
import { drawGiveaway, publishCompetition } from "../lib/admin.ts";
import { closePool, one, query } from "../lib/db.ts";

let failures: string[] = [];
let passes = 0;

function check(name: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    passes += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}\n        got  ${a}\n        want ${b}`);
  }
}

// --------------------------------------------------------------- interception
const sent: string[] = [];
api.config.use(async (_prev, method, payload: any) => {
  if (method === "sendMessage") sent.push(String(payload.text ?? ""));
  return {
    ok: true,
    result: { message_id: 1, date: 0, chat: { id: 1, type: "channel" }, text: "" },
  } as any;
});

const MARK = "__announce_test__";
const HOUR = 3_600_000;

async function makeCompetition(
  type: string,
  status: string,
  locksAt: Date | null,
): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO competitions
       (name, type, status, prize_amount, winner_count, opens_at, locks_at,
        scoring, tiebreakers, created_by)
     VALUES ($1, $2, $3, 10, 1, now() - interval '1 hour', $4,
             '{"correct_outcome":1,"exact_score":0}'::jsonb,
             '["points","submitted_at"]'::jsonb, NULL)
     RETURNING id`,
    [`${MARK} ${type} ${Date.now()}`, type, status, locksAt],
  );
  return row!.id;
}

/** A moneyrace cannot be published without a match, so give it one. */
async function withMatch(competitionId: number): Promise<void> {
  const fixture = await one<{ id: number }>(
    `INSERT INTO fixtures (provider, external_id, home_team, away_team, kickoff_at, status)
     VALUES ('test', $1, '${MARK} Home', '${MARK} Away', now() + interval '3 hours', 'NS')
     RETURNING id`,
    [-Math.floor(Math.random() * 9_000_000) - 1],
  );
  await query(
    "INSERT INTO competition_fixtures (competition_id, fixture_id, position) VALUES ($1,$2,1)",
    [competitionId, fixture!.id],
  );
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM competitions WHERE name LIKE $1`, [`${MARK}%`]);
  await query(`DELETE FROM fixtures WHERE home_team LIKE $1`, [`${MARK}%`]);
}

async function main(): Promise<void> {
  await cleanup();

  // ===================================================== the rule, on its own
  // Pure, so every combination is checkable rather than the handful his data
  // happens to contain.
  const now = new Date("2026-08-30T10:17:00Z");
  const later = new Date("2026-08-30T11:17:00Z");
  const earlier = new Date("2026-08-29T11:17:00Z");

  check("a giveaway never has a tip reminder to send",
    notificationApplies("giveaway", "reminder"), false);
  check("...nor a Tippschluss-closed post",
    notificationApplies("giveaway", "locked"), false);
  check("...but it is still announced when it opens",
    notificationApplies("giveaway", "opened"), true);
  check("...and its winner is still announced",
    notificationApplies("giveaway", "winner"), true);
  check("a moneyrace has all of them",
    ["opened", "reminder", "locked", "winner"]
      .every((k) => notificationApplies("moneyrace", k)), true);
  check("so does an exact-score round",
    ["opened", "reminder", "locked", "winner"]
      .every((k) => notificationApplies("exact_score", k)), true);

  // THE REGRESSION, as the exact shape it happened in.
  check("the reminder that actually went out is refused",
    notificationStillTrue("reminder",
      { type: "giveaway", status: "finished", locks_at: later }, now).ok, false);
  check("...and it says why",
    notificationStillTrue("reminder",
      { type: "giveaway", status: "finished", locks_at: later }, now).reason,
    'a giveaway has no Tippschluss, so a "reminder" announcement does not apply to it');

  check("a reminder for a live moneyrace an hour out is sent",
    notificationStillTrue("reminder",
      { type: "moneyrace", status: "open", locks_at: later }, now).ok, true);
  check("...but not once it has been drawn or scored",
    notificationStillTrue("reminder",
      { type: "moneyrace", status: "finished", locks_at: later }, now).ok, false);
  check("...nor once the Tippschluss has passed",
    notificationStillTrue("reminder",
      { type: "moneyrace", status: "open", locks_at: earlier }, now).ok, false);
  check("...nor when there is no Tippschluss at all",
    notificationStillTrue("reminder",
      { type: "moneyrace", status: "open", locks_at: null }, now).ok, false);

  check("an opening is announced only while it is open",
    notificationStillTrue("opened",
      { type: "moneyrace", status: "open", locks_at: later }, now).ok, true);
  check("...never for a draft",
    notificationStillTrue("opened",
      { type: "moneyrace", status: "draft", locks_at: later }, now).ok, false);
  check("...and never after it has locked - that is a door already shut",
    notificationStillTrue("opened",
      { type: "moneyrace", status: "locked", locks_at: earlier }, now).ok, false);

  check("a closing post needs it to actually be closed",
    notificationStillTrue("locked",
      { type: "moneyrace", status: "locked", locks_at: earlier }, now).ok, true);
  check("...and is refused while it is still open",
    notificationStillTrue("locked",
      { type: "moneyrace", status: "open", locks_at: later }, now).ok, false);

  check("a winner is announced only for a finished competition",
    notificationStillTrue("winner",
      { type: "moneyrace", status: "finished", locks_at: earlier }, now).ok, true);
  check("...not for one still being evaluated",
    notificationStillTrue("winner",
      { type: "moneyrace", status: "evaluating", locks_at: earlier }, now).ok, false);
  check("a cancelled competition announces nothing",
    ["opened", "reminder", "locked", "winner"].some((k) =>
      notificationStillTrue(k,
        { type: "moneyrace", status: "cancelled", locks_at: later }, now).ok), false);

  // =============================================== what publishing queues, live
  const give = await makeCompetition("giveaway", "draft", new Date(Date.now() + 4 * HOUR));
  await publishCompetition(give, null);
  const giveReminders = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM notifications WHERE competition_id=$1 AND kind='reminder'",
    [give],
  );
  check("publishing a giveaway queues no reminder, even with an end time",
    giveReminders!.n, 0);
  const giveOpened = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM notifications WHERE competition_id=$1 AND kind='opened'",
    [give],
  );
  check("...it is still announced as opened", giveOpened!.n, 1);

  const race = await makeCompetition("moneyrace", "draft", new Date(Date.now() + 4 * HOUR));
  await withMatch(race);
  await publishCompetition(race, null);
  const raceReminder = await one<{ due_at: Date }>(
    "SELECT due_at FROM notifications WHERE competition_id=$1 AND kind='reminder'",
    [race],
  );
  check("a moneyrace with a future Tippschluss does get one",
    Boolean(raceReminder), true);
  check("...dated an hour before the lock, not now",
    raceReminder ? new Date(raceReminder.due_at).getTime() > Date.now() : false, true);

  // A lock time that has already gone would mean due_at in the past, and the
  // very next tick posting "one hour to go" AFTER the thing closed. Publishing
  // refuses it outright, which is the better answer - and publishCompetition
  // also declines to queue a reminder dated in the past, which is what still
  // protects a big reminder_hours_before_lock against a lock that is nearer
  // than that. (That setting is global and live, so this file never writes it.)
  const late = await makeCompetition("moneyrace", "draft", new Date(Date.now() - 2 * HOUR));
  await withMatch(late);
  let refused = "";
  try {
    await publishCompetition(late, null);
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  check("publishing something whose Tippschluss has gone is refused",
    refused.includes("already in the past"), true);
  const lateReminder = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM notifications WHERE competition_id=$1 AND kind='reminder'",
    [late],
  );
  check("...so no reminder whose moment has already passed exists",
    lateReminder!.n, 0);

  // ================================================== retiring what is queued
  const drawn = await makeCompetition("giveaway", "open", new Date(Date.now() + 4 * HOUR));
  const user = await one<{ id: number }>(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES (990000901, '${MARK}user', 'Test')
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
  );
  await query(
    "INSERT INTO participants (competition_id, user_id) VALUES ($1,$2)",
    [drawn, user!.id],
  );
  // Due in an hour: the live worker claims nothing that is not yet due, so this
  // row cannot be delivered by anyone while the test is deciding what it means.
  await query(
    `INSERT INTO notifications (competition_id, kind, due_at)
     VALUES ($1, 'reminder', now() + interval '1 hour')`,
    [drawn],
  );
  await drawGiveaway(drawn, null);
  const retired = await one<{ skipped_at: Date | null; skip_reason: string | null }>(
    "SELECT skipped_at, skip_reason FROM notifications WHERE competition_id=$1 AND kind='reminder'",
    [drawn],
  );
  check("drawing a giveaway retires what was still queued for it",
    Boolean(retired?.skipped_at), true);
  check("...with the reason recorded",
    retired?.skip_reason, "the winner was drawn before this came due");

  // ============================================ what the worker actually claims
  // The whole path, without running the sender: the real claim query picks the
  // row up, and the real rule refuses it. Both halves are needed - a claim that
  // returned nothing would make any "nothing was sent" assertion vacuous.
  //
  // The control row is due in the PAST, which is the one shape the live worker
  // could also claim. It is safe by construction: it is a finished giveaway's
  // reminder, so the deployed worker reaches the same verdict and skips it too.
  const stale = await makeCompetition("giveaway", "finished", new Date(Date.now() - 2 * HOUR));
  await query(
    `INSERT INTO notifications (competition_id, kind, due_at)
     VALUES ($1, 'reminder', now() - interval '1 hour')`,
    [stale],
  );
  const claimed = (await dueNotifications()).filter((n) => n.competition_id === stale);
  check("the worker does claim the row - so refusing it means something",
    claimed.length, 1);
  check("...and reads the competition as it stands now, not as it was queued",
    claimed[0]?.status, "finished");
  check("...and then refuses to send it",
    claimed[0] ? notificationStillTrue(claimed[0].kind, claimed[0]).ok : null, false);

  // A skipped row is out of the claim entirely, so it can never be reconsidered.
  await query(
    "UPDATE notifications SET skipped_at = now(), skip_reason = 'test' WHERE competition_id = $1",
    [stale],
  );
  check("once skipped it is not claimed again",
    (await dueNotifications()).filter((n) => n.competition_id === stale).length, 0);
  const stillDead = await one<{ sent_at: Date | null; attempts: number }>(
    "SELECT sent_at, attempts FROM notifications WHERE competition_id=$1",
    [stale],
  );
  check("...and is never marked sent", stillDead?.sent_at, null);
  check("...and burns no retry", stillDead?.attempts, 0);
  check("and nothing was posted while all that happened", sent.length, 0);

  // cancelPendingNotifications leaves the winner post alone - the finish queues
  // it in the same breath, and retiring it would mean nobody is ever announced.
  const fin = await makeCompetition("moneyrace", "finished", new Date(Date.now() - 4 * HOUR));
  await query(
    `INSERT INTO notifications (competition_id, kind, due_at)
     VALUES ($1, 'winner', now() + interval '1 hour'),
            ($1, 'reminder', now() + interval '1 hour')`,
    [fin],
  );
  const dropped = await cancelPendingNotifications(fin, "test");
  check("retiring a finished competition drops one row", dropped, 1);
  const winnerRow = await one<{ skipped_at: Date | null }>(
    "SELECT skipped_at FROM notifications WHERE competition_id=$1 AND kind='winner'",
    [fin],
  );
  check("...and the winner announcement is not one of them",
    winnerRow?.skipped_at, null);

  await cleanup();
  await query("DELETE FROM users WHERE telegram_id = 990000901");

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (sent.length) {
    console.log(`NOTE: ${sent.length} message(s) were intercepted, none delivered`);
  }
  for (const name of failures) console.log(`  FAILED: ${name}`);
  await closePool();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  await closePool();
  process.exit(1);
});
