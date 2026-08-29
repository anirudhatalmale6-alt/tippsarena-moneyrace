/**
 * Tests. Run with `npm test`.
 *
 * Two halves:
 *   1. Pure logic - scoring, ranking, tie-breaking, payload parsing, templates.
 *      No database, no network, so they are exact and they are fast.
 *   2. The lock, against a real database, because §11 is the rule the whole
 *      product rests on and a rule that has only been reasoned about is not
 *      tested. These create their own competition and delete it afterwards.
 *
 * Written to be run twice back to back: the database half cleans up after
 * itself, so a second run must give the same answer as the first.
 */
import { closePool, getSetting, one, query, setSetting } from "../lib/db.ts";
import {
  competitionFixtures,
  evaluateCompetition,
  isOpenForPredictions,
  joinCompetition,
  leaderboard,
  PredictionsLockedError,
  savePrediction,
  type Competition,
} from "../lib/competitions.ts";
import { outcomeOf, isFinished, isAbandoned } from "../lib/football.ts";
import {
  DEFAULT_SCORING,
  normaliseScoring,
  normaliseTiebreakers,
  rank,
  scorePrediction,
  winners,
  type Standing,
} from "../lib/scoring.ts";
import { fill, money, escapeHtml } from "../lib/templates.ts";
import { parseStartPayload } from "../lib/users.ts";

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

// =================================================================== scoring
{
  const s = { correct_outcome: 1, exact_score: 3 };

  check(
    "a correct outcome scores the configured points",
    scorePrediction(
      { pick: "H", homeGoals: null, awayGoals: null },
      { outcome: "H", homeGoals: 2, awayGoals: 1 },
      s,
    ),
    { points: 1, isCorrect: true, isExact: false },
  );

  check(
    "a wrong outcome scores nothing",
    scorePrediction(
      { pick: "D", homeGoals: null, awayGoals: null },
      { outcome: "H", homeGoals: 2, awayGoals: 1 },
      s,
    ),
    { points: 0, isCorrect: false, isExact: false },
  );

  check(
    "an exact score pays the bonus ON TOP of the outcome",
    scorePrediction(
      { pick: "H", homeGoals: 2, awayGoals: 1 },
      { outcome: "H", homeGoals: 2, awayGoals: 1 },
      s,
    ),
    { points: 4, isCorrect: true, isExact: true },
  );

  // The bonus can never be the whole prize on its own: an "exact score" that
  // disagrees with the outcome is impossible, but a malformed row must not pay.
  check(
    "an exact-score guess with the wrong pick pays nothing",
    scorePrediction(
      { pick: "A", homeGoals: 2, awayGoals: 1 },
      { outcome: "H", homeGoals: 2, awayGoals: 1 },
      s,
    ),
    { points: 0, isCorrect: false, isExact: true },
  );

  check(
    "a match with no result yet scores nothing and is not counted wrong",
    scorePrediction(
      { pick: "H", homeGoals: null, awayGoals: null },
      { outcome: null, homeGoals: null, awayGoals: null },
      s,
    ),
    { points: 0, isCorrect: false, isExact: false },
  );

  check(
    "no prediction at all scores nothing",
    scorePrediction(
      { pick: null, homeGoals: null, awayGoals: null },
      { outcome: "D", homeGoals: 1, awayGoals: 1 },
      s,
    ),
    { points: 0, isCorrect: false, isExact: false },
  );

  check(
    "a zero exact bonus is honoured, not treated as unset",
    scorePrediction(
      { pick: "H", homeGoals: 2, awayGoals: 1 },
      { outcome: "H", homeGoals: 2, awayGoals: 1 },
      { correct_outcome: 1, exact_score: 0 },
    ).points,
    1,
  );

  check("garbage scoring config falls back to the default",
    normaliseScoring({ correct_outcome: "three" }), DEFAULT_SCORING);
  check("a null scoring config falls back to the default",
    normaliseScoring(null), DEFAULT_SCORING);
}

// =================================================================== outcomes
{
  check("2-1 is a home win", outcomeOf(2, 1), "H");
  check("1-2 is an away win", outcomeOf(1, 2), "A");
  check("0-0 is a draw", outcomeOf(0, 0), "D");
  check("no goals means no outcome", outcomeOf(null, 1), null);
  truthy("FT counts as finished", isFinished("FT"));
  truthy("extra time counts as finished", isFinished("AET"));
  truthy("half time does NOT count as finished", !isFinished("HT"));
  truthy("a postponed match is abandoned, not finished", isAbandoned("PST"));
  truthy("...and is not treated as a result", !isFinished("PST"));
}

// =================================================================== ranking
{
  const make = (
    id: number,
    points: number,
    exact: number,
    submitted: number | null,
  ): Standing => ({
    participantId: id,
    points,
    exactHits: exact,
    correctCount: points,
    submittedAt: submitted,
  });

  const ranked = rank([
    make(1, 7, 0, 1000),
    make(2, 9, 1, 5000),
    make(3, 8, 0, 2000),
    make(4, 8, 2, 9000),
  ]);
  check("most points first", ranked.map((r) => r.participantId), [2, 4, 3, 1]);
  check("...with ranks 1..4", ranked.map((r) => r.rank), [1, 2, 3, 4]);

  // Equal on everything the operator configured: they share the rank, and the
  // next rank skips. Inventing an order here would be a coin toss over money.
  const tied = rank([make(1, 5, 0, 100), make(2, 5, 0, 100), make(3, 4, 0, 50)]);
  check("a genuine tie shares a rank", tied.map((r) => r.rank), [1, 1, 3]);

  const early = rank([make(1, 5, 0, 9000), make(2, 5, 0, 100)]);
  check("the earlier submission breaks the tie",
    early.map((r) => r.participantId), [2, 1]);

  const never = rank([make(1, 5, 0, null), make(2, 5, 0, 9_999_999)]);
  check("somebody who never finished sorts LAST, not first",
    never.map((r) => r.participantId), [2, 1]);

  check("winners takes everyone on a paying rank, ties included",
    winners(tied, 1).map((r) => r.participantId), [1, 2]);
  check("...and nobody when there is no prize",
    winners(tied, 0).length, 0);

  check("points is forced to the front of a bad tiebreak list",
    normaliseTiebreakers(["submitted_at", "points"]),
    ["points", "submitted_at"]);
  check("unknown tiebreak keys are dropped",
    normaliseTiebreakers(["points", "coin_toss"]), ["points"]);
  check("a missing tiebreak list falls back to the default",
    normaliseTiebreakers(undefined), ["points", "exact_hits", "submitted_at"]);
}

// =================================================================== payloads
{
  check("a referral link is read as a referral",
    parseStartPayload("ref_12345"),
    { campaign: null, referrerTelegramId: 12345, raw: "ref_12345" });
  check("a campaign link is read as a campaign",
    parseStartPayload("meta_campaign_1"),
    { campaign: "meta_campaign_1", referrerTelegramId: null, raw: "meta_campaign_1" });
  check("an empty payload is nothing at all",
    parseStartPayload(""), { campaign: null, referrerTelegramId: null, raw: null });
  // Telegram itself allows A-Za-z0-9_- in a start parameter, so the hyphens
  // stay and only the characters we could never have sent are dropped.
  check("characters Telegram cannot send are stripped",
    parseStartPayload("meta;drop--table").campaign, "metadrop--table");
  check("a 200-character payload is cut to something storable",
    parseStartPayload("a".repeat(200)).campaign?.length, 64);
  check("ref_ with no number is not a referral",
    parseStartPayload("ref_abc").referrerTelegramId, null);
}

// =================================================================== templates
{
  check("a placeholder is filled", fill("Preis: {prize}", { prize: "250 €" }),
    "Preis: 250 €");
  check("an unknown placeholder is left visible, not blanked",
    fill("Hallo {nobody}", {}), "Hallo {nobody}");
  check("a null value is left visible too",
    fill("Hallo {x}", { x: null }), "Hallo {x}");
  check("the same placeholder twice is filled twice",
    fill("{a} und {a}", { a: "1" }), "1 und 1");

  check("whole euros carry no decimals", money(250), "250 €");
  // Two decimals, not one: "99,50 €" is how a price is written in German, and
  // a prize list where some rows have one decimal and some two looks broken.
  check("part euros carry exactly two decimals", money(99.5), "99,50 €");
  check("thousands use the German separator", money(1250), "1.250 €");

  check("html special characters are escaped",
    escapeHtml('Bayern & <b>Dortmund</b>'),
    "Bayern &amp; &lt;b&gt;Dortmund&lt;/b&gt;");
}

// =================================================================== the lock
// Against a real database. This is §11, the rule everything else depends on.
{
  const now = new Date();
  const past = new Date(now.getTime() - 60_000);
  const future = new Date(now.getTime() + 3_600_000);

  const openComp = { status: "open", opens_at: null, locks_at: future } as unknown as Competition;
  truthy("an open competition with a future lock accepts predictions",
    isOpenForPredictions(openComp, now));

  truthy("...and refuses them once the lock time has passed",
    !isOpenForPredictions(
      { status: "open", opens_at: null, locks_at: past } as unknown as Competition,
      now,
    ));

  truthy("a competition that has not opened yet refuses them",
    !isOpenForPredictions(
      { status: "open", opens_at: future, locks_at: null } as unknown as Competition,
      now,
    ));

  truthy("a draft refuses them however good its times are",
    !isOpenForPredictions(
      { status: "draft", opens_at: past, locks_at: future } as unknown as Competition,
      now,
    ));

  // ---- and now for real, through the database
  const tag = `test-${process.pid}-${Date.now()}`;
  const comp = (await query<{ id: number }>(
    `INSERT INTO competitions
       (name, type, status, prize_amount, winner_count, requires_membership,
        opens_at, locks_at, scoring)
     VALUES ($1,'moneyrace','open',100,1,false,now() - interval '1 hour',
             now() + interval '1 hour', '{"correct_outcome":1,"exact_score":3}')
     RETURNING id`,
    [tag],
  ))[0];

  const fixture = (await query<{ id: number }>(
    `INSERT INTO fixtures
       (provider, external_id, home_team, away_team, kickoff_at, status)
     VALUES ('test', $1, 'Bayern', 'Dortmund', now() + interval '2 hours', 'NS')
     RETURNING id`,
    [-Math.floor(Math.random() * 1_000_000) - 1],
  ))[0];

  const cf = (await query<{ id: number }>(
    `INSERT INTO competition_fixtures (competition_id, fixture_id, position)
     VALUES ($1, $2, 1) RETURNING id`,
    [comp.id, fixture.id],
  ))[0];

  const user = (await query<{ id: number }>(
    `INSERT INTO users (telegram_id, username) VALUES ($1, $2) RETURNING id`,
    [-Math.floor(Math.random() * 1_000_000) - 1, tag],
  ))[0];

  const participant = await joinCompetition(comp.id, user.id);
  const again = await joinCompetition(comp.id, user.id);
  check("joining twice does not create a second entry", again.id, participant.id);

  await savePrediction(comp.id, participant.id, cf.id, { pick: "H" });
  check(
    "the prediction is stored",
    (await one<{ pick: string }>(
      "SELECT pick FROM predictions WHERE participant_id = $1",
      [participant.id],
    ))?.pick,
    "H",
  );

  const firstSubmit = (await one<{ submitted_at: Date }>(
    "SELECT submitted_at FROM participants WHERE id = $1",
    [participant.id],
  ))!.submitted_at;
  truthy("finishing the set stamps submitted_at", firstSubmit !== null);

  await savePrediction(comp.id, participant.id, cf.id, { pick: "A" });
  check(
    "changing a pick BEFORE the lock is allowed",
    (await one<{ pick: string }>(
      "SELECT pick FROM predictions WHERE participant_id = $1",
      [participant.id],
    ))?.pick,
    "A",
  );
  check(
    "...and does not move them down the tiebreak order",
    String(
      (await one<{ submitted_at: Date }>(
        "SELECT submitted_at FROM participants WHERE id = $1",
        [participant.id],
      ))!.submitted_at,
    ),
    String(firstSubmit),
  );

  // A prediction into a competition the fixture does not belong to.
  const otherComp = (await query<{ id: number }>(
    `INSERT INTO competitions (name, type, status, locks_at)
     VALUES ($1,'moneyrace','open', now() + interval '1 hour') RETURNING id`,
    [`${tag}-other`],
  ))[0];
  let crossRejected = false;
  try {
    await savePrediction(otherComp.id, participant.id, cf.id, { pick: "H" });
  } catch {
    crossRejected = true;
  }
  truthy("a fixture from another competition is refused", crossRejected);

  // ---- now close it, and try again
  await query("UPDATE competitions SET locks_at = now() - interval '1 minute' WHERE id = $1",
    [comp.id]);

  let lockedRejected = false;
  try {
    await savePrediction(comp.id, participant.id, cf.id, { pick: "D" });
  } catch (err) {
    lockedRejected = err instanceof PredictionsLockedError;
  }
  truthy("a prediction AFTER the lock is refused", lockedRejected);
  check(
    "...and the stored pick is untouched",
    (await one<{ pick: string }>(
      "SELECT pick FROM predictions WHERE participant_id = $1",
      [participant.id],
    ))?.pick,
    "A",
  );

  // ---- results arrive, and the scoring runs
  await query(
    `UPDATE fixtures SET status='FT', home_goals=1, away_goals=2, outcome='A'
      WHERE id = $1`,
    [fixture.id],
  );
  const evaluation = await evaluateCompetition(comp.id);
  check("evaluating a finished competition reports it complete",
    { scored: evaluation.scored, missing: evaluation.missingResults, complete: evaluation.complete },
    { scored: 1, missing: 0, complete: true });

  const scored = await one<{ points: number; rank: number; correct_count: number }>(
    "SELECT points, rank, correct_count FROM participants WHERE id = $1",
    [participant.id],
  );
  check("the right pick scored a point", scored?.points, 1);
  check("...and took rank 1", scored?.rank, 1);

  const board = await leaderboard(comp.id, 5);
  check("the leaderboard has one entry", board.length, 1);
  check("...and it is the right person", board[0].user_id, user.id);

  // A missing result must NOT produce a winner.
  await query("UPDATE fixtures SET status='NS', home_goals=NULL, away_goals=NULL, outcome=NULL WHERE id=$1",
    [fixture.id]);
  const pending = await evaluateCompetition(comp.id);
  check("a competition with a missing result is not complete",
    { missing: pending.missingResults, complete: pending.complete },
    { missing: 1, complete: false });
  check("...and nobody is marked a winner",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id=$1 AND is_winner",
      [comp.id],
    ))?.n,
    0);
  truthy("...and the reason is recorded for the dashboard",
    Boolean(
      (await one<{ evaluation_note: string | null }>(
        "SELECT evaluation_note FROM competitions WHERE id = $1",
        [comp.id],
      ))?.evaluation_note,
    ));

  const fixtureCount = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM competition_fixtures WHERE competition_id = $1",
    [comp.id],
  );
  check("the competition still has its fixture", fixtureCount?.n, 1);
  check("competitionFixtures returns it in order",
    (await competitionFixtures(comp.id)).map((f) => f.position), [1]);

  // ---- clean up, so this suite can be run again and again
  await query("DELETE FROM competitions WHERE id = ANY($1)", [[comp.id, otherComp.id]]);
  await query("DELETE FROM fixtures WHERE id = $1", [fixture.id]);
  await query("DELETE FROM users WHERE id = $1", [user.id]);
  check("the test data is gone again",
    (await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM competitions WHERE name LIKE $1",
      [`${tag}%`],
    ))?.n,
    0);
}

// ================================================== announcements and config
// A channel that is not configured yet must not burn a notification's retries.
// Publish five competitions before setting the channel and all five
// announcements would otherwise give up for good, silently.
{
  const { sendDueNotifications } = await import("../worker/index.ts");
  const tag = `notif-${process.pid}-${Date.now()}`;

  // Through setSetting, not a raw UPDATE: the column is JSONB NOT NULL, so a
  // JSON null read back into JS and written straight out again becomes an SQL
  // NULL and is rejected. setSetting stringifies, which is what the dashboard
  // will do too.
  const previous = await getSetting<string>("channel_chat_id", null);
  await setSetting("channel_chat_id", null);

  const comp = (await query<{ id: number }>(
    `INSERT INTO competitions (name, type, status, locks_at)
     VALUES ($1,'moneyrace','open', now() + interval '1 hour') RETURNING id`,
    [tag],
  ))[0];
  await query(
    `INSERT INTO notifications (competition_id, kind, due_at)
     VALUES ($1, 'opened', now())`,
    [comp.id],
  );

  await sendDueNotifications();
  await sendDueNotifications();
  await sendDueNotifications();

  const row = await one<{ attempts: number; sent_at: Date | null }>(
    "SELECT attempts, sent_at FROM notifications WHERE competition_id = $1",
    [comp.id],
  );
  check("an unconfigured channel does not consume the retries",
    { attempts: row?.attempts, sent: row?.sent_at !== null }, { attempts: 0, sent: false });
  truthy("...and the announcement is still waiting to go out",
    row !== null && row.sent_at === null);

  await query("DELETE FROM competitions WHERE id = $1", [comp.id]);
  await setSetting("channel_chat_id", previous);
}

console.log(
  `\n${failures.length ? `FAILURES: ${failures.join(", ")}` : "ALL PASSED"}  ` +
    `(${passes} passed, ${failures.length} failed)`,
);
await closePool();
process.exit(failures.length ? 1 : 0);
