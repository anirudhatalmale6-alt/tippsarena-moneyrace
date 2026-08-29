/**
 * Automatic results, and the trap that stops them.
 *
 * Results arrive by themselves: the worker polls every fixture that has kicked
 * off and belongs to a running competition, and writes a score only when the
 * provider says the match is over. What broke that on his live competition was
 * a hand-typed result - `manual` locks the API out of a fixture for good, and
 * an invented 0:0 on a match that had not started became the score the
 * competition would have been settled on.
 *
 * These check both halves: that the poller sees what it should, and that
 * handing a fixture back to the API really hands it back.
 *
 * Uses its own fixtures throughout - provider 'test', negative external ids -
 * so it can never touch a real match or a real competition.
 */
import { closePool, one, query } from "../lib/db.ts";
import {
  clearManualResult,
  findFixture,
  fixturesNeedingResults,
  setManualResult,
} from "../lib/fixtures.ts";
import { kickoffInFuture } from "../lib/fixtures.ts";

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

const MARK = `restest-${process.pid}-${Date.now()}`;

async function cleanup(): Promise<void> {
  await query("DELETE FROM competitions WHERE name LIKE $1", [`%${MARK}%`]);
  await query(
    "DELETE FROM fixtures WHERE provider = 'test' AND home_team LIKE $1",
    [`%${MARK}%`],
  );
}

/** A fixture with whatever provider payload we want it to have had. */
async function makeFixture(
  kickoff: string,
  providerStatus: string | null,
): Promise<number> {
  const raw = providerStatus
    ? JSON.stringify({ fixture: { status: { short: providerStatus } } })
    : JSON.stringify({});
  const rows = await query<{ id: number }>(
    `INSERT INTO fixtures
       (provider, external_id, home_team, away_team, kickoff_at, status, raw)
     VALUES ('test', $1, $2, 'Away FC', now() + $3::interval, $4, $5::jsonb)
     RETURNING id`,
    [
      -Math.floor(Math.random() * 9_000_000) - 1,
      `Home FC ${MARK}`,
      kickoff,
      providerStatus ?? "NS",
      raw,
    ],
  );
  return rows[0].id;
}

async function main(): Promise<void> {
  await cleanup();

  // ===================================================== what the poller sees
  const comp = (await query<{ id: number }>(
    `INSERT INTO competitions
       (name, type, status, prize_amount, winner_count, requires_membership,
        opens_at, locks_at, published_at)
     VALUES ($1,'moneyrace','locked',10,1,false,
             now() - interval '3 hours', now() - interval '1 hour', now())
     RETURNING id`,
    [`${MARK} comp`],
  ))[0];

  const started = await makeFixture("-90 minutes", "NS");
  const notStarted = await makeFixture("3 hours", "NS");
  for (const [f, pos] of [[started, 1], [notStarted, 2]] as const) {
    await query(
      "INSERT INTO competition_fixtures (competition_id, fixture_id, position) VALUES ($1,$2,$3)",
      [comp.id, f, pos],
    );
  }

  let watching = (await fixturesNeedingResults()).map((f) => f.id);
  truthy("a match that has kicked off is polled", watching.includes(started));
  check("...and one that has not is left alone", watching.includes(notStarted), false);

  // ============================================ a hand-typed result locks it out
  await setManualResult(started, 3, 1);
  const typed = await findFixture(started);
  check("a hand-typed result is stored", [typed!.home_goals, typed!.away_goals], [3, 1]);
  check("...and flagged as typed", typed!.manual, true);

  watching = (await fixturesNeedingResults()).map((f) => f.id);
  check("...and the poller stops watching it", watching.includes(started), false);

  // =========================================== handing it back to the API
  await clearManualResult(started);
  const handedBack = await findFixture(started);
  check("handing it back clears the flag", handedBack!.manual, false);
  // THE bug: clearing only the flag left the score in place, so the fixture
  // stayed out of `fixturesNeedingResults` (which looks for a null outcome) and
  // the API never got another chance at it.
  check("...and the invented score with it", handedBack!.home_goals, null);
  check("...and the outcome", handedBack!.outcome, null);

  watching = (await fixturesNeedingResults()).map((f) => f.id);
  truthy("...so the poller picks it up again", watching.includes(started));

  // ============================ a genuinely finished match keeps its score
  const real = await makeFixture("-3 hours", "FT");
  await query(
    "UPDATE fixtures SET home_goals = 2, away_goals = 0, outcome = 'H' WHERE id = $1",
    [real],
  );
  await setManualResult(real, 9, 9);
  await clearManualResult(real);
  const kept = await findFixture(real);
  // The provider's own payload says FT, so there is a real result underneath
  // the correction and it stays until the next poll refreshes it.
  check("a match the provider reported finished keeps a score",
    [kept!.home_goals, kept!.away_goals], [9, 9]);
  check("...and stays out of the poll queue",
    (await fixturesNeedingResults()).map((f) => f.id).includes(real), false);

  // The two fixtures went through exactly the same calls - setManualResult then
  // clearManualResult - and came out differently, which is the whole point. The
  // only thing that differed was the provider payload. Both had status 'FT'
  // written by setManualResult, so a rule reading the status column would have
  // treated them identically and kept the invented score in both.
  check("the one the provider never finished is back to not-started",
    (await findFixture(started))!.status, "NS");
  check("...while the one it did finish is still finished",
    (await findFixture(real))!.status, "FT");

  // ================================= the warning before a premature result
  check("a match that has not kicked off is flagged before typing a result",
    await kickoffInFuture(notStarted), true);
  check("...and one that has already started is not",
    await kickoffInFuture(started), false);

  await cleanup();
  const left = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM fixtures WHERE home_team LIKE $1", [`%${MARK}%`]);
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
