/**
 * Broadcasts and the "is it live?" rules, against the real database.
 *
 * NOTHING LEAVES THIS PROCESS. A transformer is installed on the same Api the
 * worker sends through, so every message is captured instead of delivered - the
 * users table holds his actual customers and a test that DMs them is not a test,
 * it is an incident.
 *
 * The second guard is the row itself: every broadcast this file creates is dated
 * an hour in the future, and the worker's claim() ignores anything not yet due.
 * So even with the live worker running beside it, these rows can only ever be
 * picked up by the line below that names them explicitly.
 *
 * Everything it makes, it deletes - the file has to give the same answer run
 * twice in a row.
 */
import { api } from "../worker/announce.ts";
import { runBroadcastById } from "../worker/broadcast.ts";
import { queueBroadcast, audienceSize } from "../lib/broadcast.ts";
import { deleteCompetition, deleteImpact, publishReadiness, visibility } from "../lib/admin.ts";
import { announcementTemplate, competitionVars, plural } from "../lib/messagevars.ts";
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
function truthy(name: string, got: unknown): void {
  check(name, Boolean(got), true);
}

// --------------------------------------------------------------- interception
const sent: Array<{ chat_id: string; text: string }> = [];
let nextMessageId = 5000;
let refuse = new Set<string>();

api.config.use(async (_prev, method, payload: any) => {
  if (method !== "sendMessage") return { ok: true, result: true } as any;
  const chat = String(payload.chat_id);
  if (refuse.has(chat)) {
    // What Telegram answers for somebody who blocked the bot.
    return {
      ok: false,
      error_code: 403,
      description: "Forbidden: bot was blocked by the user",
    } as any;
  }
  sent.push({ chat_id: chat, text: payload.text });
  return {
    ok: true,
    result: {
      message_id: ++nextMessageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: payload.chat_id, type: "private" },
      text: payload.text,
    },
  } as any;
});

// --------------------------------------------------------------- fixtures
const TEST_IDS = [990000101, 990000102, 990000103];
const MARK = "__broadcast_test__";

async function makeUsers(): Promise<number[]> {
  const ids: number[] = [];
  for (const telegramId of TEST_IDS) {
    const row = await one<{ id: number }>(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES ($1, $2, 'Test')
       ON CONFLICT (telegram_id) DO UPDATE
         SET is_blocked = FALSE, username = EXCLUDED.username
       RETURNING id`,
      [telegramId, `${MARK}${telegramId}`],
    );
    ids.push(row!.id);
  }
  return ids;
}

/** Future-dated, so the live worker cannot see it. */
async function queueForTest(body: string, audience: any): Promise<number> {
  const queued = await queueBroadcast({ body, audience });
  await query(
    "UPDATE broadcasts SET created_at = now() + interval '1 hour' WHERE id = $1",
    [queued.id],
  );
  return queued.id;
}

async function cleanup(): Promise<void> {
  await query("DELETE FROM broadcasts WHERE body LIKE $1", [`%${MARK}%`]);
  await query("DELETE FROM competitions WHERE name LIKE $1", [`%${MARK}%`]);
  await query("DELETE FROM users WHERE username LIKE $1", [`%${MARK}%`]);
  await query("DELETE FROM users WHERE telegram_id = ANY($1::bigint[])", [TEST_IDS]);
}

async function main(): Promise<void> {
  await cleanup();

  // ============================================================== visibility
  // The words the dashboard puts on a competition. This is the whole fix for
  // "I created two competitions and they are not in the bot".
  const past = new Date(Date.now() - 3_600_000);
  const future = new Date(Date.now() + 3_600_000);

  check("a fresh draft is not visible",
    visibility({ status: "draft", published_at: null, opens_at: null }).visible, false);
  check("...and says why",
    visibility({ status: "draft", published_at: null, opens_at: null }).label, "Not visible");
  check("an open competition is visible",
    visibility({ status: "open", published_at: past, opens_at: past }).visible, true);
  check("a draft published for later reads as scheduled",
    visibility({ status: "draft", published_at: past, opens_at: future }).label, "Scheduled");
  check("...and is still not visible yet",
    visibility({ status: "draft", published_at: past, opens_at: future }).visible, false);
  check("a locked competition is not enterable",
    visibility({ status: "locked", published_at: past, opens_at: past }).visible, false);
  // Published, but the start time has come and gone and the worker has flipped
  // it - that is 'open', not 'scheduled'. A draft whose start is in the past is
  // still waiting for the next tick, and must not claim to be live.
  check("a published draft whose start has passed does not claim to be live",
    visibility({ status: "draft", published_at: past, opens_at: past }).visible, false);
  check("...and does not ask him to publish it again",
    visibility({ status: "draft", published_at: past, opens_at: past }).label, "Opening");

  // ============================================================== readiness
  const [{ id: compId }] = await query<{ id: number }>(
    `INSERT INTO competitions (name, type, status, prize_amount, winner_count,
                               requires_membership)
     VALUES ($1, 'moneyrace', 'draft', 100, 1, false) RETURNING id`,
    [`${MARK} readiness`],
  );

  let ready = await publishReadiness(compId);
  check("no lock time and no matches blocks publishing", ready.ready, false);
  check("...and names both problems", ready.blockers.length, 2);
  truthy("...one of them about the lock time",
    ready.blockers.some((b) => /lock time/i.test(b)));
  truthy("...the other about matches",
    ready.blockers.some((b) => /matches/i.test(b)));

  await query("UPDATE competitions SET locks_at = $2 WHERE id = $1", [compId, past]);
  ready = await publishReadiness(compId);
  truthy("a lock time in the past is refused",
    ready.blockers.some((b) => /past/i.test(b)));

  await query("UPDATE competitions SET locks_at = $2 WHERE id = $1", [compId, future]);
  ready = await publishReadiness(compId);
  check("with a future lock time only the matches are missing", ready.blockers.length, 1);

  // A giveaway needs no matches - the one exception, and it has to keep working.
  await query("UPDATE competitions SET type = 'giveaway' WHERE id = $1", [compId]);
  ready = await publishReadiness(compId);
  check("a giveaway can publish without matches", ready.ready, true);
  check("...and there is nothing left to fix", ready.blockers.length, 0);

  await query("UPDATE competitions SET prize_amount = 0 WHERE id = $1", [compId]);
  ready = await publishReadiness(compId);
  check("a prize of zero is a warning, not a refusal", ready.ready, true);
  truthy("...and is said out loud", ready.warnings.some((w) => /0/.test(w)));

  // ============================================================== broadcasts
  const before = await audienceSize();
  const userIds = await makeUsers();
  const after = await audienceSize();
  check("three test users join the audience", after - before, 3);

  // ---- direct messages
  sent.length = 0;
  const dmId = await queueForTest(`${MARK} hello everyone`, "users");
  await runBroadcastById(dmId);

  const dm = await one<any>("SELECT * FROM broadcasts WHERE id = $1", [dmId]);
  check("the direct-message broadcast finished", dm.status, "done");
  check("...and reached everyone it counted", dm.sent, after);
  check("...with nothing left unreachable", dm.failed, 0);
  check("...and sent exactly that many messages", sent.length, after);
  for (const telegramId of TEST_IDS) {
    truthy(`...including ${telegramId}`,
      sent.some((m) => m.chat_id === String(telegramId)));
  }
  truthy("...with the text intact",
    sent.every((m) => m.text === `${MARK} hello everyone`));

  // ---- the resume guarantee: running it again sends nothing
  sent.length = 0;
  await runBroadcastById(dmId);
  check("a finished broadcast cannot be sent a second time", sent.length, 0);

  // ---- an interrupted broadcast resumes at the cursor
  sent.length = 0;
  const resumeId = await queueForTest(`${MARK} resume me`, "users");
  // Pretend it died after the first two users.
  const [firstTwo] = await query<{ cutoff: string }>(
    `SELECT id AS cutoff FROM users WHERE is_blocked = FALSE ORDER BY id OFFSET 1 LIMIT 1`,
  );
  await query(
    `UPDATE broadcasts SET status = 'sending', cursor_user_id = $2, sent = 2
      WHERE id = $1`,
    [resumeId, firstTwo.cutoff],
  );
  await runBroadcastById(resumeId);
  const resumed = await one<any>("SELECT * FROM broadcasts WHERE id = $1", [resumeId]);
  check("a resumed broadcast only sends the rest", sent.length, after - 2);
  check("...and its total is still right", resumed.sent, after);
  const skipped = await query<{ telegram_id: string }>(
    "SELECT telegram_id FROM users WHERE is_blocked = FALSE AND id <= $1",
    [firstTwo.cutoff],
  );
  truthy("...and nobody before the cursor was messaged again",
    skipped.every((u) => !sent.some((m) => m.chat_id === String(u.telegram_id))));

  // ---- somebody who blocked the bot is counted, not fatal
  sent.length = 0;
  refuse = new Set([String(TEST_IDS[1])]);
  const blockedId = await queueForTest(`${MARK} one blocked`, "users");
  await runBroadcastById(blockedId);
  const withBlocked = await one<any>("SELECT * FROM broadcasts WHERE id = $1", [blockedId]);
  check("one blocked user does not stop the rest", withBlocked.status, "done");
  check("...the others still got it", withBlocked.sent, after - 1);
  check("...and the failure is counted", withBlocked.failed, 1);
  refuse = new Set();

  // ---- the channel half, with no channel connected
  const channel = await one<{ value: string | null }>(
    "SELECT value #>> '{}' AS value FROM settings WHERE key = 'channel_chat_id'",
  );
  if (!channel?.value) {
    sent.length = 0;
    const chanId = await queueForTest(`${MARK} channel only`, "channel");
    await runBroadcastById(chanId);
    const waiting = await one<any>("SELECT * FROM broadcasts WHERE id = $1", [chanId]);
    check("with no channel connected it waits instead of failing", waiting.status, "queued");
    truthy("...and says so", /channel/i.test(waiting.error ?? ""));
    check("...and nothing was sent", sent.length, 0);

    // The important half: a "both" broadcast still reaches the users even
    // though the channel is not there. Losing the direct messages because a
    // channel is missing would be the worst of both.
    sent.length = 0;
    const bothId = await queueForTest(`${MARK} both halves`, "both");
    await runBroadcastById(bothId);
    const both = await one<any>("SELECT * FROM broadcasts WHERE id = $1", [bothId]);
    check("a 'both' broadcast still delivers the direct messages", both.sent, after);
    check("...and finishes", both.status, "done");
  } else {
    console.log("SKIP  channel checks - a channel is configured on this database");
  }

  // ============================================ deleting a competition
  // He asked for this because a mis-typed competition should not sit in the
  // list for ever. It is genuinely destructive, so what matters is that the
  // counts he is shown BEFORE pressing are the real ones.
  const [{ id: doomed }] = await query<{ id: number }>(
    `INSERT INTO competitions (name, type, status, prize_amount, winner_count,
                               requires_membership, locks_at)
     VALUES ($1,'moneyrace','open',50,1,false, now() + interval '2 hours')
     RETURNING id`,
    [`${MARK} doomed`],
  );
  let impact = await deleteImpact(doomed);
  check("an empty competition reports nothing attached",
    [impact!.participants, impact!.predictions, impact!.prizes], [0, 0, 0]);
  check("...and is not flagged as serious", impact!.serious, false);

  // Put a real person and a real prize in it.
  const victim = (await query<{ id: number }>(
    `INSERT INTO users (telegram_id, username) VALUES ($1, $2)
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [-960000001, `${MARK}-user`],
  ))[0];
  const part = (await query<{ id: number }>(
    "INSERT INTO participants (competition_id, user_id) VALUES ($1,$2) RETURNING id",
    [doomed, victim.id],
  ))[0];
  await query(
    "INSERT INTO prizes (competition_id, user_id, rank, amount) VALUES ($1,$2,1,50)",
    [doomed, victim.id],
  );

  impact = await deleteImpact(doomed);
  check("a competition with somebody in it counts them", impact!.participants, 1);
  check("...counts the unpaid prize", impact!.prizes_unpaid, 1);
  check("...and IS flagged as serious", impact!.serious, true);

  await deleteCompetition(doomed, null);
  check("the competition is gone",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM competitions WHERE id = $1", [doomed]))?.n, 0);
  check("...and its participants went with it",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM participants WHERE id = $1", [part.id]))?.n, 0);
  check("...and its prizes",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM prizes WHERE competition_id = $1", [doomed]))?.n, 0);
  // The audit row must survive - and carry the numbers, because after the
  // delete there is nothing left to count.
  const trace = await one<{ summary: string }>(
    `SELECT summary FROM audit_logs WHERE action = 'competition.delete'
       AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [String(doomed)],
  );
  truthy("...but the audit record stays", trace !== null);
  truthy("...saying how many people were in it",
    /1 participant/.test(trace!.summary));
  await query("DELETE FROM users WHERE id = $1", [victim.id]);
  await query("DELETE FROM audit_logs WHERE entity_id = $1 AND action = 'competition.delete'",
    [String(doomed)]);

  check("deleting something that is not there is refused",
    await deleteImpact(999_999_999), null);

  // ================================== announcement wording follows the type
  check("a giveaway is announced as a giveaway",
    announcementTemplate("giveaway"), "channel_giveaway");
  check("an exact-score round gets its own text",
    announcementTemplate("exact_score"), "channel_exact_new");
  check("a moneyrace gets the moneyrace text",
    announcementTemplate("moneyrace"), "channel_competition_new");
  check("...and a reminder is a reminder whatever the type",
    announcementTemplate("giveaway", "reminder"), "channel_reminder");

  // "1 Spiele" and "1 Tipps" are what he actually saw. German plurals cannot be
  // done with a number and a placeholder, so the words are built here.
  check("one match is a Spiel", plural(1, "Spiel", "Spiele"), "1 Spiel");
  check("...and five are Spiele", plural(5, "Spiel", "Spiele"), "5 Spiele");
  check("one tip is a Tipp", plural(1, "Tipp", "Tipps"), "1 Tipp");
  check("...and zero are Tipps", plural(0, "Tipp", "Tipps"), "0 Tipps");

  const [{ id: worded }] = await query<{ id: number }>(
    `INSERT INTO competitions (name, type, status, prize_amount, winner_count,
                               requires_membership, locks_at)
     VALUES ($1,'exact_score','open',100,1,false, now() + interval '2 hours')
     RETURNING id`,
    [`${MARK} worded`],
  );
  const f = (await query<{ id: number }>(
    `INSERT INTO fixtures (provider, external_id, home_team, away_team, kickoff_at, status)
     VALUES ('test', $1, 'FSV Mainz 05', 'SC Paderborn 07', now() + interval '3 hours', 'NS')
     RETURNING id`,
    [-Math.floor(Math.random() * 9_000_000) - 1],
  ))[0];
  await query(
    "INSERT INTO competition_fixtures (competition_id, fixture_id, position) VALUES ($1,$2,1)",
    [worded, f.id],
  );
  const vars = await competitionVars(worded);
  check("a one-match round says Spiel, not Spiele", vars.matches, "1 Spiel");
  check("...and names the match itself", vars.match, "FSV Mainz 05 — SC Paderborn 07");
  check("...with the prize formatted", vars.prize, "100 €");
  await query("DELETE FROM competitions WHERE id = $1", [worded]);
  await query("DELETE FROM fixtures WHERE id = $1", [f.id]);

  // ---- an empty message is refused before it is stored
  let refused = false;
  try {
    await queueBroadcast({ body: "   ", audience: "users" });
  } catch {
    refused = true;
  }
  check("an empty broadcast is refused", refused, true);

  // ============================================================== cleanup
  await query("DELETE FROM competitions WHERE id = $1", [compId]);
  await cleanup();

  const leftover = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM users WHERE telegram_id = ANY($1::bigint[])",
    [TEST_IDS],
  );
  check("the test users are gone again", leftover?.n, 0);

  console.log(
    `\n${failures.length ? `FAILURES: ${failures.join(", ")}` : "ALL PASSED"}` +
      `  (${passes} passed, ${failures.length} failed)`,
  );
  await closePool();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  await closePool();
  process.exit(1);
});
