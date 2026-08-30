/**
 * Exact Score, end to end: the points, the winner, and the post that follows.
 *
 * His words: "So if no one gets the exact score no one gets points at all.
 * Please fix that. only 3 points for the exact score that goes to the monthly
 * competition."
 *
 * The pure scoring is asserted in run.ts. What is asserted HERE is the thing
 * that actually cost him money: a real competition, evaluated by the real
 * evaluator, with a real tip of 3:1 on a match that finished 2:0 - and then the
 * channel post that comes out of it. The bug he reported was never in the
 * arithmetic; it was in what got published about the arithmetic, so the post is
 * part of the test.
 *
 * The rule is a live setting he can change from the dashboard, and a test that
 * writes to it would be changing a global switch while his worker is running.
 * So this file READS the rule and asserts whichever behaviour that rule
 * requires, printing which branch ran. It never flips it.
 *
 * Everything is seeded and deleted: its own users (negative telegram ids), its
 * own fixture (provider 'test', negative external id), its own competitions.
 */
import { closePool, one, query } from "../lib/db.ts";
import { evaluateCompetition } from "../lib/competitions.ts";
import { exactPrizeRule, publicResult } from "../lib/winners.ts";
import { render } from "../lib/templates.ts";

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

const MARK = `exacttest-${process.pid}-${Date.now()}`;
const FIRST_TG = -970_000_000;
const EXT = -970_000_000;

async function cleanup(): Promise<void> {
  await query("DELETE FROM competitions WHERE name LIKE $1", [`%${MARK}%`]);
  await query(
    "DELETE FROM fixtures WHERE provider = 'test' AND external_id <= $1 AND external_id > $2",
    [EXT, EXT - 100],
  );
  await query(
    "DELETE FROM users WHERE telegram_id <= $1 AND telegram_id > $2",
    [FIRST_TG, FIRST_TG - 100],
  );
}

/** One finished match: 2:0, exactly the one he complained about. */
async function makeFixture(offset: number): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO fixtures
       (provider, external_id, home_team, away_team, kickoff_at, status,
        home_goals, away_goals, outcome, finished_at)
     VALUES ('test', $1, $2, $3, now() - interval '3 hours', 'FT',
             2, 0, 'H', now() - interval '1 hour')
     RETURNING id`,
    [EXT - offset, `Dortmund ${MARK}`, `HSV ${MARK}`],
  );
  return rows[0].id;
}

/**
 * A finished exact-score round with one tip per player.
 * `tips` is [homeGoals, awayGoals, pick] per player, in order.
 */
async function makeRound(
  label: string,
  offset: number,
  tips: Array<[number, number, "H" | "D" | "A"]>,
): Promise<number> {
  const fixtureId = await makeFixture(offset);
  const comp = (
    await query<{ id: number }>(
      `INSERT INTO competitions
         (name, type, status, prize_amount, currency, winner_count,
          requires_membership, opens_at, locks_at, published_at, scoring)
       VALUES ($1,'exact_score','evaluating',100,'EUR',1,false,
               now() - interval '4 hours', now() - interval '3 hours', now(),
               '{"correct_outcome":1,"exact_score":3}'::jsonb)
       RETURNING id`,
      [`${MARK} ${label}`],
    )
  )[0].id;

  const cf = (
    await query<{ id: number }>(
      `INSERT INTO competition_fixtures (competition_id, fixture_id, position)
       VALUES ($1, $2, 1) RETURNING id`,
      [comp, fixtureId],
    )
  )[0].id;

  for (let i = 0; i < tips.length; i += 1) {
    const user = (
      await query<{ id: number }>(
        `INSERT INTO users (telegram_id, username, first_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [FIRST_TG - offset * 10 - i, `exactplayer${offset}${i}`, `Exact${i}`],
      )
    )[0].id;
    const participant = (
      await query<{ id: number }>(
        `INSERT INTO participants (competition_id, user_id, submitted_at)
         VALUES ($1, $2, now() - interval '3 hours') RETURNING id`,
        [comp, user],
      )
    )[0].id;
    const [h, a, pick] = tips[i];
    await query(
      `INSERT INTO predictions
         (participant_id, competition_fixture_id, pick, home_goals, away_goals)
       VALUES ($1, $2, $3, $4, $5)`,
      [participant, cf, pick, h, a],
    );
  }
  return comp;
}

type Row = { username: string | null; points: number; is_winner: boolean };

async function standings(comp: number): Promise<Row[]> {
  return query<Row>(
    `SELECT u.username, pa.points, pa.is_winner
       FROM participants pa JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1 ORDER BY pa.points DESC, pa.id`,
    [comp],
  );
}

async function main(): Promise<void> {
  await cleanup();

  const rule = await exactPrizeRule();
  console.log(`\n---- Exact Score rule in force: ${rule}\n`);

  // ============================================ nobody hit the exact score
  //
  // Player 0 tips 3:1 on a match that finished 2:0 - his exact complaint.
  // Player 1 tips 1:2 and is wrong outright.
  const missed = await makeRound("missed", 1, [
    [3, 1, "H"],
    [1, 2, "A"],
  ]);
  await evaluateCompetition(missed);
  const missedRows = await standings(missed);
  const near = missedRows.find((r) => r.username === "exactplayer10")!;

  if (rule === "exact_only") {
    check("3:1 on a 2:0 scores nothing at all", near.points, 0);
    check("...so nobody in the round has any points",
      missedRows.every((r) => r.points === 0), true);
    check("...and nobody is a winner",
      missedRows.some((r) => r.is_winner), false);
  } else {
    check("under 3/1 the right winner still scores 1", near.points, 1);
    check("...and that one point wins the round", near.is_winner, true);
  }

  // A missed round must contribute nothing to the monthly standings. This is
  // the query the dashboard's monthly board runs, restricted to this round -
  // asserting the SUM, because "0 points" and "not in the table" are different
  // failures and only the sum catches both.
  const contributed = await one<{ n: number }>(
    `SELECT COALESCE(SUM(pa.points),0)::int AS n
       FROM participants pa WHERE pa.competition_id = $1`,
    [missed],
  );
  check(
    rule === "exact_only"
      ? "a round nobody hit adds nothing to the monthly standings"
      : "under 3/1 a missed round still adds its consolation point",
    contributed!.n,
    rule === "exact_only" ? 0 : 1,
  );

  // ---- and what the channel is told about it
  const missedPost = await publicResult(missed);
  if (rule === "exact_only") {
    check("the channel gets the no-winner post",
      missedPost.templateKey, "channel_exact_no_winner");
    check("...naming nobody", missedPost.named, 0);
    const body = (await render(missedPost.templateKey!, missedPost.vars as any)).text;
    truthy("...leading with the real final score", body.includes("2:0"));
    truthy("...saying outright that nobody hit it",
      body.includes("niemand das exakte Ergebnis"));
    truthy("...and that the money is not paid",
      body.includes("nicht ausgezahlt"));
    // The failure that started all this: a tip printed where a result belongs.
    check("...and 3:1 appears nowhere in it", body.includes("3:1"), false);
    check("...no winner medal either", body.includes("🥇"), false);
  } else {
    check("under 3/1 the channel gets a winner post",
      missedPost.templateKey, "channel_exact_winner");
    const body = (await render(missedPost.templateKey!, missedPost.vars as any)).text;
    truthy("...but says the exact score was missed",
      body.includes("hatte niemand"));
    truthy("...with the final score above the tip",
      body.indexOf("Endstand") < body.indexOf("Tipp"));
  }

  // ================================================= somebody DID hit it
  //
  // Same match, same rule, one player on 2:0. This has to pay under BOTH
  // settings - a rule that stops anyone winning at all would pass every
  // assertion above and be completely broken.
  const hit = await makeRound("hit", 2, [
    [2, 0, "H"],
    [3, 1, "H"],
  ]);
  await evaluateCompetition(hit);
  const hitRows = await standings(hit);
  const winner = hitRows.find((r) => r.username === "exactplayer20")!;
  const alsoRan = hitRows.find((r) => r.username === "exactplayer21")!;

  check("the exact score pays 3", winner.points, 3);
  check("...and wins", winner.is_winner, true);
  check("...and it is the only win", hitRows.filter((r) => r.is_winner).length, 1);
  check(
    rule === "exact_only"
      ? "the near miss still scores nothing"
      : "the near miss still scores its consolation point",
    alsoRan.points,
    rule === "exact_only" ? 0 : 1,
  );

  const hitPost = await publicResult(hit);
  check("the channel gets the winner post",
    hitPost.templateKey, "channel_exact_winner");
  check("...naming exactly one person", hitPost.named, 1);
  const hitBody = (await render(hitPost.templateKey!, hitPost.vars as any)).text;
  truthy("...saying the score was hit exactly", hitBody.includes("EXAKT RICHTIG"));
  truthy("...with the final score", hitBody.includes("2:0"));
  truthy("...and 3 Punkte, not 4", hitBody.includes("3 Punkte"));
  check("...not 4 Punkte anywhere", hitBody.includes("4 Punkte"), false);
  truthy("...and the winner's @name in full, as he insisted",
    hitBody.includes("@exactplayer20"));

  await cleanup();

  // The cleanup is verified, not assumed - this file writes to his live tables.
  const left = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM users WHERE telegram_id <= $1 AND telegram_id > $2",
    [FIRST_TG, FIRST_TG - 100],
  );
  check("every seeded player is gone from his database", left?.n, 0);
  const comps = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM competitions WHERE name LIKE $1", [`%${MARK}%`]);
  check("...and both seeded competitions", comps?.n, 0);

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
  }
  await closePool();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  await closePool();
  process.exit(1);
});
