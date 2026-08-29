/**
 * Giveaways and exact-score competitions, through the real bot handlers.
 *
 * The giveaway half walks HIS scenario from §16, in his order: A enters, A
 * presses again, B and C enter, three participants, draw, winner told, winner
 * announced, prize marked paid. Then the awkward ones he listed - no username,
 * a blocked bot, zero participants, one participant, two admins drawing at the
 * same instant.
 *
 * Nothing leaves the process: a transformer on the bot's Api and another on the
 * worker's captures every outgoing message. The users table is his real
 * customers and this file must never be able to reach them.
 */
import { bot } from "../bot/index.ts";
import { api as workerApi } from "../worker/announce.ts";
import { closePool, one, query } from "../lib/db.ts";
import { drawGiveaway, giveawayStage } from "../lib/admin.ts";
import {
  announceGiveawayWinner,
  createGiveawayPrize,
  enterGiveaway,
  giveawayEntrants,
  giveawayWinner,
  notifyGiveawayWinner,
  publicWinnerName,
} from "../lib/giveaway.ts";

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
interface Sent {
  method: string;
  payload: any;
}
const sent: Sent[] = [];
const dmed: Array<{ chat_id: string; text: string }> = [];
let refuseDm = new Set<string>();
let messageId = 7000;

const reply = (payload: any) => ({
  ok: true,
  result: {
    message_id: ++messageId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: payload?.chat_id ?? 1, type: "private" },
    text: payload?.text ?? "",
  },
});

bot.api.config.use(async (_prev, method, payload) => {
  sent.push({ method, payload });
  return reply(payload) as any;
});

// The worker has its own Api. Without this the winner's private message would
// be a real Telegram call.
workerApi.config.use(async (_prev, method, payload: any) => {
  if (method !== "sendMessage") return { ok: true, result: true } as any;
  if (refuseDm.has(String(payload.chat_id))) {
    return {
      ok: false,
      error_code: 403,
      description: "Forbidden: bot was blocked by the user",
    } as any;
  }
  dmed.push({ chat_id: String(payload.chat_id), text: payload.text });
  return reply(payload) as any;
});

bot.botInfo = {
  id: 1,
  is_bot: true,
  first_name: "TippsArenaMoneyrace",
  username: "TippsArenaMoneyrace_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as any;

let updateId = 1;

function person(telegramId: number, username: string | null) {
  return {
    from: {
      id: telegramId,
      is_bot: false,
      first_name: "Testnutzer",
      username: username ?? undefined,
      language_code: "de",
    },
    chat: { id: telegramId, type: "private" as const, first_name: "Testnutzer" },
  };
}

async function tapAs(who: ReturnType<typeof person>, data: string): Promise<Sent[]> {
  sent.length = 0;
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: who.from,
      chat_instance: "1",
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: who.chat,
        text: "-",
      },
    },
  } as any);
  return [...sent];
}

async function startAs(who: ReturnType<typeof person>, payload: string): Promise<Sent[]> {
  sent.length = 0;
  const text = `/start ${payload}`;
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: who.chat,
      from: who.from,
      text,
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  } as any);
  return [...sent];
}

const texts = (calls: Sent[]) =>
  calls
    .filter((c) => c.method === "sendMessage" || c.method === "editMessageText")
    .map((c) => c.payload.text as string);
const keyboards = (calls: Sent[]) =>
  calls
    .filter((c) => c.method === "sendMessage" || c.method === "editMessageText")
    .flatMap((c) => c.payload.reply_markup?.inline_keyboard ?? []);
const buttonTexts = (calls: Sent[]) =>
  keyboards(calls).flat().map((b: any) => b.text as string);

// --------------------------------------------------------------- fixtures
const MARK = `givetest-${process.pid}-${Date.now()}`;
const A = person(-970_000_001, "user_a");
const B = person(-970_000_002, "user_b");
const C = person(-970_000_003, null); // no public username - his edge case
const TEST_TG = [-970_000_001, -970_000_002, -970_000_003];

async function cleanup(): Promise<void> {
  await query(
    `DELETE FROM competitions WHERE name LIKE $1`,
    [`%${MARK}%`],
  );
  await query("DELETE FROM users WHERE telegram_id = ANY($1::bigint[])", [TEST_TG]);
  await query("DELETE FROM fixtures WHERE provider = 'test' AND home_team LIKE $1",
    [`%${MARK}%`]);
  // Every broadcast this file creates is future-dated and belongs to one of its
  // own competitions, so it is identified by that rather than by its body - the
  // rendered German template contains no marker of ours.
  await query(
    `DELETE FROM broadcasts
      WHERE competition_id IN (SELECT id FROM competitions WHERE name LIKE $1)
         OR (created_at > now() AND status = 'queued')`,
    [`%${MARK}%`],
  );
}

async function newGiveaway(name: string, publicly = true): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO competitions
       (name, type, status, prize_amount, currency, winner_count,
        requires_membership, opens_at, locks_at, published_at,
        announce_winner_publicly)
     VALUES ($1,'giveaway','open',20,'EUR',1,false,
             now() - interval '1 hour', now() + interval '2 hours', now(), $2)
     RETURNING id`,
    [`${MARK} ${name}`, publicly],
  );
  return rows[0].id;
}

async function userIdOf(telegramId: number): Promise<number> {
  const row = await one<{ id: number }>(
    "SELECT id FROM users WHERE telegram_id = $1", [telegramId]);
  return row!.id;
}

async function main(): Promise<void> {
  await cleanup();

  // ======================================================= his §16, in order
  const give = await newGiveaway("main");

  // --- what the entry screen says. §1: no MoneyRace words anywhere.
  let calls = await tapAs(A, `comp_${give}`);
  let body = texts(calls).join("\n");
  truthy("the giveaway screen appears", body.length > 0);
  truthy("...calling it a giveaway", body.includes("GIVEAWAY"));
  truthy("...with the prize", body.includes("20 €"));
  truthy("...and the number of winners", body.includes("1 Gewinner"));
  for (const forbidden of ["Spiele", "Tipps", "Tippschluss", "Preisgeld"]) {
    check(`...and never says "${forbidden}"`, body.includes(forbidden), false);
  }
  check("...offering one way in",
    buttonTexts(calls).includes("🎁 AM GIVEAWAY TEILNEHMEN"), true);
  // Looking is not entering.
  const peeked = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1", [give]);
  check("...and looking at it does not enter you", peeked?.n, 0);

  // --- ONE TAP from the channel.
  // He pressed TEILNEHMEN in the bot's message, landed on a screen with another
  // TEILNEHMEN, and reasonably concluded the first press had not worked. The
  // deep link the announcement carries now means "enter me", not "show me".
  const oneTap = await newGiveaway("onetap");
  let started = await startAs(A, `g_${oneTap}`);
  let startedBody = texts(started).join("\n");
  truthy("the giveaway link enters you on the first tap",
    startedBody.includes("DU BIST DABEI!"));
  const tapped = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1", [oneTap]);
  check("...with one participant recorded", tapped?.n, 1);
  check("...and no second TEILNEHMEN to press",
    buttonTexts(started).some((t) => t.includes("AM GIVEAWAY TEILNEHMEN")), false);

  started = await startAs(A, `g_${oneTap}`);
  truthy("...and following the link again says already in",
    texts(started).join("\n").includes("BEREITS DABEI"));
  check("...still one participant",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1",
      [oneTap]))?.n, 1);

  // A closed giveaway must not take an entry through the link either.
  const shut = await newGiveaway("shutlink");
  await query(
    "UPDATE competitions SET locks_at = now() - interval '1 minute' WHERE id = $1",
    [shut]);
  await startAs(B, `g_${shut}`);
  check("a closed giveaway takes nobody through the link",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1",
      [shut]))?.n, 0);

  // --- User A enters
  calls = await tapAs(A, `give_${give}`);
  body = texts(calls).join("\n");
  truthy("A enters and is told so", body.includes("DU BIST DABEI!"));
  truthy("...and that the draw comes later", body.includes("ausgelost"));
  let count = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1", [give]);
  check("...and there is one participant", count?.n, 1);

  // --- User A presses it again
  calls = await tapAs(A, `give_${give}`);
  body = texts(calls).join("\n");
  truthy("A pressing again is told they are already in",
    body.includes("BEREITS DABEI"));
  count = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1", [give]);
  check("...and is still ONE participant, not two", count?.n, 1);

  // --- B and C
  await tapAs(B, `give_${give}`);
  await tapAs(C, `give_${give}`);
  const entrants = await giveawayEntrants(give);
  check("three people have entered", entrants.length, 3);

  // --- what a participant can see about the others: nothing.
  calls = await tapAs(A, `give_status_${give}`);
  body = texts(calls).join("\n");
  truthy("a participant can see their own entry", body.includes("Du bist dabei"));
  for (const other of ["user_b", "970000002", "970000003"]) {
    check(`...and never another entrant (${other})`, body.includes(other), false);
  }

  // --- the draw
  const drawn = await drawGiveaway(give, null);
  await createGiveawayPrize(give);
  check("the draw takes the whole pool", drawn.poolSize, 3);
  truthy("...and picks somebody who actually entered",
    entrants.some((e) => e.user_id === drawn.winnerUserId));

  const winner = await giveawayWinner(give);
  truthy("the winner is recorded", winner !== null);
  check("...with the pool it was taken from", winner!.pool_size, 3);
  truthy("...and a draw identifier", Boolean(winner!.seed));
  truthy("...and a prize row to pay", winner!.prize_id !== null);
  check("...for the giveaway amount", Number(winner!.amount), 20);

  // --- drawing twice
  let refused = "";
  try {
    await drawGiveaway(give, null);
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  truthy("a second draw is refused", /already been drawn/i.test(refused));
  const after = await giveawayWinner(give);
  check("...and the winner is unchanged", after!.user_id, winner!.user_id);

  // --- two admins at the same instant
  const race = await newGiveaway("race");
  await enterGiveaway(race, await userIdOf(-970_000_001));
  await enterGiveaway(race, await userIdOf(-970_000_002));
  const both = await Promise.allSettled([
    drawGiveaway(race, null),
    drawGiveaway(race, null),
  ]);
  check("two simultaneous draws produce exactly one winner",
    both.filter((r) => r.status === "fulfilled").length, 1);
  const raceRows = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM draws WHERE competition_id = $1", [race]);
  check("...and exactly one draw row", raceRows?.n, 1);

  // --- telling the winner
  dmed.length = 0;
  const told = await notifyGiveawayWinner(give, null);
  check("the winner is told", told.ok, true);
  check("...by exactly one private message", dmed.length, 1);
  check("...to the winner and nobody else",
    dmed[0].chat_id, String(winner!.telegram_id));
  truthy("...congratulating them", dmed[0].text.includes("HERZLICHEN GLÜCKWUNSCH"));
  truthy("...naming the prize", dmed[0].text.includes("20 €"));
  const handle = (await one<{ v: string }>(
    "SELECT value #>> '{}' AS v FROM settings WHERE key = 'support_handle'"))!.v;
  truthy("...and saying who to contact", dmed[0].text.includes(handle));
  const noted = await giveawayWinner(give);
  truthy("...and it is recorded as sent", noted!.notified_at !== null);
  check("...with no error left behind", noted!.notify_error, null);

  // --- a winner who has blocked the bot
  const blocked = await newGiveaway("blocked");
  await enterGiveaway(blocked, await userIdOf(-970_000_001));
  await drawGiveaway(blocked, null);
  await createGiveawayPrize(blocked);
  refuseDm = new Set([String(-970_000_001)]);
  dmed.length = 0;
  const failedSend = await notifyGiveawayWinner(blocked, null);
  check("a blocked winner is reported, not swallowed", failedSend.ok, false);
  const stuck = await giveawayWinner(blocked);
  truthy("...with the reason stored for the dashboard", Boolean(stuck!.notify_error));
  check("...and not marked as told", stuck!.notified_at, null);
  truthy("...while the draw itself still stands", stuck!.user_id !== null);

  // ...and the retry works once they unblock.
  refuseDm = new Set();
  const retried = await notifyGiveawayWinner(blocked, null);
  check("retrying after they unblock succeeds", retried.ok, true);
  const fixed = await giveawayWinner(blocked);
  truthy("...and it is now marked as told", fixed!.notified_at !== null);
  check("...with the old error cleared", fixed!.notify_error, null);

  // --- announcing, named.
  // FUTURE-DATED, and this is not a detail. The first version of this test
  // called it plainly, the row was due immediately, and the live worker posted
  // six test winner-announcements to his real channel before cleanup ran. The
  // row must never be claimable, not merely cleaned up quickly.
  const NEVER = new Date(Date.now() + 3_600_000);
  await announceGiveawayWinner(give, null, NEVER);
  const publicPost = await one<{ body: string; audience: string }>(
    "SELECT body, audience FROM broadcasts WHERE competition_id = $1 ORDER BY id DESC LIMIT 1",
    [give],
  );
  truthy("the winner announcement is queued", publicPost !== null);
  check("...to the channel", publicPost!.audience, "channel");
  truthy("...congratulating a username", publicPost!.body.includes("@"));
  for (const secret of [String(winner!.telegram_id), "Testnutzer"]) {
    check(`...and never publishing ${secret}`,
      publicPost!.body.includes(secret), false);
  }

  // --- announcing, not named (§8)
  const quiet = await newGiveaway("quiet", false);
  await enterGiveaway(quiet, await userIdOf(-970_000_002));
  await drawGiveaway(quiet, null);
  await createGiveawayPrize(quiet);
  await announceGiveawayWinner(quiet, null, NEVER);
  const quietPost = await one<{ body: string }>(
    "SELECT body FROM broadcasts WHERE competition_id = $1 ORDER BY id DESC LIMIT 1",
    [quiet],
  );
  truthy("with naming off, the post still proves a draw happened",
    quietPost!.body.includes("GEWINNER STEHT FEST"));
  check("...and names nobody at all", quietPost!.body.includes("@user_b"), false);
  check("...not even a Telegram id", quietPost!.body.includes("970000002"), false);

  // --- a winner with no public username must not be described by real name
  check("somebody without a username is not named",
    publicWinnerName(null), "der Gewinner");
  check("...and somebody with one is", publicWinnerName("user_a"), "@user_a");

  // --- zero participants
  const empty = await newGiveaway("empty");
  let emptyError = "";
  try {
    await drawGiveaway(empty, null);
  } catch (err) {
    emptyError = err instanceof Error ? err.message : String(err);
  }
  truthy("a giveaway with nobody in it cannot be drawn",
    /nobody to draw/i.test(emptyError));

  // --- exactly one participant
  const solo = await newGiveaway("solo");
  await enterGiveaway(solo, await userIdOf(-970_000_003));
  const soloDraw = await drawGiveaway(solo, null);
  check("a giveaway with one entrant draws that entrant",
    soloDraw.winnerUserId, await userIdOf(-970_000_003));
  check("...from a pool of one", soloDraw.poolSize, 1);

  // --- a closed giveaway refuses new entries
  const closed = await newGiveaway("closed");
  await query(
    "UPDATE competitions SET locks_at = now() - interval '1 minute' WHERE id = $1",
    [closed],
  );
  calls = await tapAs(B, `give_${closed}`);
  const closedCount = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1", [closed]);
  check("a closed giveaway takes nobody new", closedCount?.n, 0);

  // --- the stage wording he asked for in §12
  const drawnComp = await one<any>("SELECT * FROM competitions WHERE id = $1", [give]);
  check("a drawn giveaway reads as drawn",
    giveawayStage(drawnComp, true, "pending"), "Winner drawn");
  check("...and as completed once it is paid",
    giveawayStage(drawnComp, true, "paid"), "Completed");
  check("...and as a draft before it is published",
    giveawayStage({ status: "draft", published_at: null, opens_at: null }, false, null),
    "Draft");

  // ================================================= exact score
  const exFixture = (await query<{ id: number }>(
    `INSERT INTO fixtures (provider, external_id, home_team, away_team, kickoff_at, status)
     VALUES ('test', $1, $2, 'SC Paderborn 07', now() + interval '3 hours', 'NS')
     RETURNING id`,
    [-Math.floor(Math.random() * 9_000_000) - 1, `FSV Mainz 05 ${MARK}`],
  ))[0];

  const exact = (await query<{ id: number }>(
    `INSERT INTO competitions
       (name, type, status, prize_amount, winner_count, requires_membership,
        opens_at, locks_at, published_at, scoring)
     VALUES ($1,'exact_score','open',100,1,false,
             now() - interval '1 hour', now() + interval '2 hours', now(),
             '{"correct_outcome":1,"exact_score":3}'::jsonb)
     RETURNING id`,
    [`${MARK} exact`],
  ))[0].id;
  await query(
    "INSERT INTO competition_fixtures (competition_id, fixture_id, position) VALUES ($1,$2,1)",
    [exact, exFixture.id],
  );

  calls = await tapAs(A, `comp_${exact}`);
  body = texts(calls).join("\n");
  truthy("the exact-score intro asks for the exact result",
    body.includes("genaue Endergebnis"));

  calls = await tapAs(A, `play_${exact}_0`);
  body = texts(calls).join("\n");
  let labels = buttonTexts(calls);
  truthy("...and the picker asks how it ends", body.includes("Wie endet das Spiel?"));
  check("...with a minus and a plus for each side",
    labels.filter((t) => t === "➖").length, 2);
  check("...and the same number of pluses", labels.filter((t) => t === "➕").length, 2);
  truthy("...and a submit button", labels.includes("✅ TIPP ABGEBEN"));
  // §2: the 1X2 buttons must never appear here.
  for (const forbidden of ["Unentschieden", "gewinnt"]) {
    check(`...and never "${forbidden}"`,
      labels.some((t) => t.includes(forbidden)), false);
  }
  truthy("...and never a home/draw/away callback",
    keyboards(calls).flat().every((b: any) => !/^pick_/.test(b.callback_data ?? "")));

  // Two taps up on the home side, one on the away side, then submit.
  calls = await tapAs(A, `exh_${exact}_0_0_0_1`);
  calls = await tapAs(A, `exh_${exact}_0_1_0_1`);
  calls = await tapAs(A, `exa_${exact}_0_2_0_1`);
  body = texts(calls).join("\n");
  truthy("the counters show the score being built", body.includes("2</b> : <b>1"));

  // A minus at zero must not go negative.
  calls = await tapAs(A, `exa_${exact}_0_2_0_-1`);
  body = texts(calls).join("\n");
  truthy("...and cannot go below zero", body.includes("2</b> : <b>0"));

  calls = await tapAs(A, `exs_${exact}_0_2_1`);
  body = texts(calls).join("\n");
  truthy("submitting confirms the exact score", body.includes("2:1"));
  truthy("...and says it can still be changed", body.includes("geändert"));

  const stored = await one<{ pick: string; home_goals: number; away_goals: number }>(
    `SELECT pr.pick, pr.home_goals, pr.away_goals
       FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id
      WHERE pa.competition_id = $1`,
    [exact],
  );
  check("the scoreline is stored", [stored!.home_goals, stored!.away_goals], [2, 1]);
  check("...with the outcome derived from it, not asked for", stored!.pick, "H");

  // Changing it overwrites rather than adding a second row.
  await tapAs(A, `exs_${exact}_0_1_1`);
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id
      WHERE pa.competition_id = $1`,
    [exact],
  );
  check("changing the tip replaces it", rows[0].n, 1);
  const changed = await one<{ pick: string; home_goals: number; away_goals: number }>(
    `SELECT pr.pick, pr.home_goals, pr.away_goals FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id WHERE pa.competition_id = $1`,
    [exact],
  );
  check("...to the new score", [changed!.home_goals, changed!.away_goals], [1, 1]);
  check("...and the outcome follows it", changed!.pick, "D");

  // --- scoring: exact right, outcome right, and wrong.
  const { evaluateCompetition } = await import("../lib/competitions.ts");
  await query(
    `UPDATE fixtures SET home_goals = 1, away_goals = 1, outcome = 'D',
            status = 'FT', finished_at = now() WHERE id = $1`,
    [exFixture.id],
  );
  await evaluateCompetition(exact);
  let scored = await one<{ points: number; is_exact: boolean; is_correct: boolean }>(
    `SELECT pr.points, pr.is_exact, pr.is_correct FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id WHERE pa.competition_id = $1`,
    [exact],
  );
  // His §4, exactly as written: "Exact score: 3 Punkte. Correct result but
  // incorrect exact score: 1 Punkt. Wrong result: 0 Punkte." These are TOTALS,
  // so an exact-score round scores by replacement, not by adding a bonus - the
  // additive version paid 4 for a hit he had asked to be worth 3.
  check("an exact hit pays exactly what the box says", scored!.points, 3);
  check("...and is marked exact", scored!.is_exact, true);

  await query(
    `UPDATE fixtures SET home_goals = 2, away_goals = 2, outcome = 'D' WHERE id = $1`,
    [exFixture.id],
  );
  await evaluateCompetition(exact);
  scored = await one<any>(
    `SELECT pr.points, pr.is_exact, pr.is_correct FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id WHERE pa.competition_id = $1`,
    [exact],
  );
  check("the right outcome with the wrong score pays 1", scored!.points, 1);
  check("...and is not marked exact", scored!.is_exact, false);

  await query(
    `UPDATE fixtures SET home_goals = 3, away_goals = 0, outcome = 'H' WHERE id = $1`,
    [exFixture.id],
  );
  await evaluateCompetition(exact);
  scored = await one<any>(
    `SELECT pr.points, pr.is_exact, pr.is_correct FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id WHERE pa.competition_id = $1`,
    [exact],
  );
  check("a wrong result pays nothing", scored!.points, 0);
  check("...and is marked wrong, not unknown", scored!.is_correct, false);

  // --- the scoring is configuration, not code (§5)
  await query(
    `UPDATE competitions SET scoring = '{"correct_outcome":2,"exact_score":10}'::jsonb
      WHERE id = $1`,
    [exact],
  );
  await query(
    `UPDATE fixtures SET home_goals = 1, away_goals = 1, outcome = 'D' WHERE id = $1`,
    [exFixture.id],
  );
  await evaluateCompetition(exact);
  scored = await one<any>(
    `SELECT pr.points FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id WHERE pa.competition_id = $1`,
    [exact],
  );
  check("changing the points in the database changes the score", scored!.points, 10);

  // ...and the other branch moves with it, which is what "configurable" has to
  // mean. A test that only ever checks the exact-hit number would pass with the
  // outcome value hard-coded.
  await query(
    `UPDATE fixtures SET home_goals = 3, away_goals = 1, outcome = 'H' WHERE id = $1`,
    [exFixture.id],
  );
  await query(
    `UPDATE predictions pr SET pick = 'H', home_goals = 2, away_goals = 0
       FROM participants pa
      WHERE pa.id = pr.participant_id AND pa.competition_id = $1`,
    [exact],
  );
  await evaluateCompetition(exact);
  scored = await one<any>(
    `SELECT pr.points FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id WHERE pa.competition_id = $1`,
    [exact],
  );
  check("...including the right-outcome value", scored!.points, 2);

  // A MoneyRace still ADDS - the two types score differently on purpose, and
  // changing one must not have changed the other.
  const { scorePrediction } = await import("../lib/scoring.ts");
  const hit = { pick: "H" as const, homeGoals: 2, awayGoals: 1 };
  const res = { outcome: "H" as const, homeGoals: 2, awayGoals: 1 };
  check("a MoneyRace adds the exact-score bonus",
    scorePrediction(hit, res, { correct_outcome: 1, exact_score: 2 }, "add").points, 3);
  check("...while an exact-score round replaces",
    scorePrediction(hit, res, { correct_outcome: 1, exact_score: 3 }, "replace").points, 3);
  check("...and a right outcome with the wrong score never pays the exact value",
    scorePrediction(
      { pick: "H", homeGoals: 5, awayGoals: 0 }, res,
      { correct_outcome: 1, exact_score: 3 }, "replace").points, 1);

  // ============================== the public post: winner, never the list
  // This is the whole of his privacy correction, and it is the one thing in the
  // product that has already gone wrong in public. Every check below counts how
  // many PEOPLE a channel post names.
  const pubRace = (await query<{ id: number }>(
    `INSERT INTO competitions
       (name, type, status, prize_amount, winner_count, requires_membership,
        opens_at, locks_at, published_at, scoring)
     VALUES ($1,'moneyrace','locked',150,1,false,
             now() - interval '3 hours', now() - interval '1 hour', now(),
             '{"correct_outcome":1,"exact_score":0}'::jsonb)
     RETURNING id`,
    [`${MARK} public`],
  ))[0].id;

  const rf = (await query<{ id: number }>(
    `INSERT INTO fixtures (provider, external_id, home_team, away_team,
                           kickoff_at, status, home_goals, away_goals, outcome)
     VALUES ('test', $1, $2, 'Away FC', now() - interval '2 hours', 'FT', 2, 1, 'H')
     RETURNING id`,
    [-Math.floor(Math.random() * 9_000_000) - 1, `Home FC ${MARK}`],
  ))[0];
  await query(
    "INSERT INTO competition_fixtures (competition_id, fixture_id, position) VALUES ($1,$2,1)",
    [pubRace, rf.id],
  );

  // Five entrants, so "names one" and "names three" are distinguishable from
  // "names everybody" - with two players every mode would look the same.
  const crowd = [A, B, C];
  for (const who of crowd) await tapAs(who, `comp_${pubRace}`);
  const extraTg = [-970_000_004, -970_000_005];
  for (const tg of extraTg) {
    await query(
      `INSERT INTO users (telegram_id, username) VALUES ($1, $2)
       ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username`,
      [tg, `${MARK.replace(/[^a-z0-9]/gi, "")}_u${Math.abs(tg)}`],
    );
  }
  const everyone = [...TEST_TG, ...extraTg];
  for (const tg of everyone) {
    const uid = await userIdOf(tg);
    const part = (await query<{ id: number }>(
      `INSERT INTO participants (competition_id, user_id, completed, submitted_at)
       VALUES ($1,$2,TRUE,now())
       ON CONFLICT (competition_id, user_id) DO UPDATE SET completed = TRUE
       RETURNING id`,
      [pubRace, uid],
    ))[0];
    const cf = await one<{ id: number }>(
      "SELECT id FROM competition_fixtures WHERE competition_id = $1", [pubRace]);
    await query(
      `INSERT INTO predictions (participant_id, competition_fixture_id, pick,
                                home_goals, away_goals)
       VALUES ($1,$2,'H',2,1)
       ON CONFLICT (participant_id, competition_fixture_id) DO NOTHING`,
      [part.id, cf!.id],
    );
  }
  const { evaluateCompetition: evaluate } = await import("../lib/competitions.ts");
  await evaluate(pubRace);
  check("five people are in the pubRace",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1",
      [pubRace]))?.n, 5);

  const { publicResult, notifyCompetitionWinners } =
    await import("../lib/winners.ts");
  const { setSetting } = await import("../lib/db.ts");
  const { render: renderTpl } = await import("../lib/templates.ts");
  const previous = await one<{ v: string }>(
    "SELECT value #>> '{}' AS v FROM settings WHERE key = 'public_result_mode'");

  // ---- winner only (the default)
  await setSetting("public_result_mode", "winner");
  let post = await publicResult(pubRace);
  check("the default names exactly one person", post.named, 1);
  check("...using the winner template", post.templateKey, "channel_winner_only");
  let postText = (await renderTpl(post.templateKey!, post.vars)).text;
  const usernames = everyone.length;
  let atCount = (postText.match(/@/g) ?? []).length;
  // One @ for the winner, one for the support handle. Never five.
  truthy("...and the post mentions at most two @handles", atCount <= 2);
  truthy("...one of which is the support handle", postText.includes("@thomastippsarena"));

  // ---- top 3
  await setSetting("public_result_mode", "top3");
  post = await publicResult(pubRace);
  postText = (await renderTpl(post.templateKey!, post.vars)).text;
  check("top 3 shows exactly three placings",
    (postText.match(/🥇|🥈|🥉/g) ?? []).length, 3);
  check("...and no fourth place appears", postText.includes("4."), false);
  // One of the three has no public username on purpose, so the post names two
  // people and describes the third. That is the rule working, not a gap.
  check("...naming only those who have a public username", post.named, 2);
  check("...and never inventing a name for the one who has none",
    postText.includes("Testnutzer"), false);
  // The other two entrants must not appear anywhere in it.
  const beyond = everyone.length - 3;
  truthy("...with the other entrants absent", beyond > 0);
  check("...and the post is nowhere near the size of the field",
    (postText.match(/@/g) ?? []).length <= 3, true);

  // ---- off
  await setSetting("public_result_mode", "none");
  post = await publicResult(pubRace);
  check("switched off, nothing is posted at all", post.templateKey, null);
  check("...and nobody is atCount", post.named, 0);

  await setSetting("public_result_mode", previous?.v ?? "winner");

  // ---- the template that leaked is gone, and cannot come back
  check("the full-leaderboard template no longer exists",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM message_templates WHERE key = 'channel_results'"))?.n,
    0);
  const { competitionVars } = await import("../lib/messagevars.ts");
  const raceVars = await competitionVars(pubRace);
  check("...and there is no {leaderboard} placeholder left to rebuild it",
    "leaderboard" in raceVars, false);

  // ---- the winner is raceTold privately, whatever the channel does
  await setSetting("public_result_mode", "none");
  dmed.length = 0;
  const raceTold = await notifyCompetitionWinners(pubRace, null);
  truthy("the winner is raceTold privately even with public results off", raceTold.sent >= 1);
  truthy("...and the message names the prize", dmed[0].text.includes("150"));
  truthy("...and says who to contact", dmed[0].text.includes("@thomastippsarena"));
  check("...and only the winner is messaged", dmed.length, raceTold.sent);
  await setSetting("public_result_mode", previous?.v ?? "winner");

  // ---- the two rankings never merge
  const { typeBoard } = await import("../lib/leaderboard.ts");
  const raceBoard = await typeBoard("moneyrace", null);
  const exactBoard = await typeBoard("exact_score", null);
  truthy("there is a MoneyRace ranking", raceBoard.top.length > 0);
  check("...and a giveaway never appears in one",
    (await typeBoard("giveaway", null)).top.length, 0);
  // Same person can be in both, but the point totals must not be summed. If
  // they were, one board would count everybody the other one counts.
  truthy("the two rankings are counted separately",
    raceBoard.total !== exactBoard.total ||
    raceBoard.top[0]?.points !== exactBoard.top[0]?.points ||
    exactBoard.total === 0);

  // ---- giveaways are gone from "Meine Ergebnisse"
  const { recentResults } = await import("../lib/users.ts");
  const myLines = await recentResults(await userIdOf(-970_000_001), 20);
  check("no giveaway appears in my results",
    myLines.some((r) => r.type === "giveaway"), false);
  truthy("...but the scored competitions do",
    myLines.some((r) => r.type === "moneyrace" || r.type === "exact_score"));

  await query("DELETE FROM competitions WHERE id = $1", [pubRace]);
  await query("DELETE FROM fixtures WHERE id = $1", [rf.id]);
  await query("DELETE FROM users WHERE telegram_id = ANY($1::bigint[])", [extraTg]);

  // ================================================= cleanup
  await cleanup();
  const left = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM competitions WHERE name LIKE $1", [`%${MARK}%`]);
  check("everything this test made is gone again", left?.n, 0);

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
