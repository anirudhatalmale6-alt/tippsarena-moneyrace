/**
 * The leaderboard: three masked names and your own position, at any size.
 *
 * There are two separate claims to prove and they fail differently.
 *
 *   WHAT IS SHOWN   at most three people plus you, masked, whatever the size of
 *                   the field. A test that seeds five players cannot tell a
 *                   working limit from a field that happened to be small, so
 *                   this file seeds enough players that an unlimited board
 *                   would be obvious - and asserts the COUNT of names in the
 *                   rendered message, not the presence of a word.
 *
 *   HOW BIG IT GETS he asked for 1,000+ "and eventually 10,000+". That is not
 *                   an assertion, it is a measurement, so the last section
 *                   really does insert ten thousand players and time the query.
 *                   It runs inside a transaction that is rolled back, so his
 *                   live tables are the same afterwards as before - and the
 *                   rollback is verified, not assumed.
 *
 * Everything here is seeded and removed. Nothing touches Telegram at all: the
 * board is pure database and pure string building.
 */
import { closePool, one, pool, query } from "../lib/db.ts";
import {
  boardText,
  competitionBoard,
  maskName,
  typeBoard,
} from "../lib/leaderboard.ts";

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

const MARK = `boardtest-${process.pid}-${Date.now()}`;
const FIRST_TG = -980_000_000;
const PLAYERS = 12;

async function cleanup(): Promise<void> {
  await query("DELETE FROM competitions WHERE name LIKE $1", [`%${MARK}%`]);
  await query(
    "DELETE FROM users WHERE telegram_id <= $1 AND telegram_id > $2",
    [FIRST_TG, FIRST_TG - 100],
  );
}

async function main(): Promise<void> {
  await cleanup();

  // =============================================================== masking
  check("a seven-letter name keeps one letter", maskName("yannick"), "y******");
  check("his own example, three letters", maskName("max"), "m***");
  check("...and five", maskName("greta"), "g****");
  check("a two-letter name is not almost readable", maskName("ab"), "a***");
  check("a very long one does not run off the screen",
    maskName("averyveryverylongusername"), "a********");
  check("no username falls back to the first name, also masked",
    maskName(null, "Thomas"), "T*****");
  check("and somebody with neither is just a player",
    maskName(null, null), "Spieler");
  check("...and an empty string is not a name either", maskName("  "), "Spieler");
  // The mask must not be reversible into the original.
  truthy("a mask never contains the rest of the name",
    !maskName("yannick").includes("annick"));

  // =============================================================== seeding
  // Twelve players with descending points, so first/second/third and "somebody
  // far down" are all distinct and knowable in advance.
  const users: number[] = [];
  for (let i = 0; i < PLAYERS; i += 1) {
    const rows = await query<{ id: number }>(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [FIRST_TG - i, `boardplayer${i}`, `Board${i}`],
    );
    users.push(rows[0].id);
  }

  const comp = (
    await query<{ id: number }>(
      `INSERT INTO competitions
         (name, type, status, prize_amount, currency, winner_count,
          requires_membership, opens_at, locks_at, published_at)
       VALUES ($1,'moneyrace','finished',100,'EUR',1,false,
               now() - interval '3 hours', now() - interval '1 hour', now())
       RETURNING id`,
      [`${MARK} race`],
    )
  )[0].id;

  for (let i = 0; i < PLAYERS; i += 1) {
    await query(
      `INSERT INTO participants (competition_id, user_id, points, rank, submitted_at)
       VALUES ($1, $2, $3, $4, now())`,
      [comp, users[i], PLAYERS - i, i + 1],
    );
  }

  // =============================================================== the board
  const me = users[8]; // ninth place, well outside the podium
  const board = await competitionBoard(comp, me);

  check("the podium is three people and no more", board.top.length, 3);
  check("...out of twelve who are in the competition", board.total, PLAYERS);
  check("the top scorer leads", board.top[0].points, PLAYERS);
  check("...ranked 1", board.top[0].rank, 1);
  check("...then 2 and 3", [board.top[1].rank, board.top[2].rank], [2, 3]);
  truthy("my own row comes back", board.me !== null);
  check("...with my real position, not a page number", board.me!.rank, 9);
  check("...and my real points", board.me!.points, PLAYERS - 8);
  check("...and I am not on the podium", board.meInTop, false);

  // The whole point: names are masked, everywhere, always.
  const everyName = [...board.top.map((r) => r.name), board.me!.name];
  check("no raw username survives into the board",
    everyName.some((n) => n.includes("boardplayer")), false);
  check("...and every name is masked", everyName.every((n) => n.includes("*")), true);

  // =============================================================== rendering
  const text = boardText(board, "MONEYRACE RANGLISTE", "leer");
  // Three podium lines plus my own, and nothing else carries a dash.
  check("the message has exactly four scored lines",
    (text.match(/—/g) ?? []).length, 4);
  truthy("...and says where I stand", text.includes("Deine Platzierung: #9"));
  truthy("...calling me Du rather than my name", text.includes("Du — 4 Punkte"));
  truthy("...separated from the podium", text.includes("─────────"));
  truthy("...and says how big the field is", text.includes("12 Teilnehmer"));
  check("no username appears in the rendered message",
    text.includes("boardplayer"), false);
  check("...and nobody's first name either", text.includes("Board"), false);
  // Nine of the twelve must be absent entirely. Counting the lines is the only
  // check that would notice a board which quietly grew back.
  check("the message is four player lines regardless of the field",
    text.split("\n").filter((l) => l.includes("Punkt")).length, 4);

  // =============================================================== edge cases
  // Somebody on the podium asking: still one podium, still their own line.
  const leader = await competitionBoard(comp, users[0]);
  check("the leader sees the same three", leader.top.length, 3);
  check("...is told they are first", leader.me!.rank, 1);
  truthy("...and is marked on the podium", leader.meInTop);
  truthy("...with an arrow on their own row",
    boardText(leader, "T", "leer").includes("👈"));

  // A stranger with no entry at all.
  const strangerRows = await query<{ id: number }>(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [FIRST_TG - 90, "boardplayerX", "BoardX"],
  );
  const stranger = await competitionBoard(comp, strangerRows[0].id);
  check("someone who has not played gets no row", stranger.me, null);
  check("...but still sees the podium", stranger.top.length, 3);
  truthy("...and is told so in words",
    boardText(stranger, "T", "leer").includes("noch nicht platziert"));

  // Nobody at all.
  const emptyComp = (
    await query<{ id: number }>(
      `INSERT INTO competitions
         (name, type, status, prize_amount, currency, winner_count,
          requires_membership, opens_at, locks_at, published_at)
       VALUES ($1,'moneyrace','finished',10,'EUR',1,false,
               now() - interval '3 hours', now() - interval '1 hour', now())
       RETURNING id`,
      [`${MARK} empty`],
    )
  )[0].id;
  const empty = await competitionBoard(emptyComp, me);
  check("an empty competition has an empty podium", empty.top.length, 0);
  check("...and a total of nobody", empty.total, 0);
  check("...and renders the empty notice", boardText(empty, "T", "keiner"),
    "🏆 <b>T</b>\n\nkeiner");

  // ============================================== ties do not blow the limit
  // A thousand people on one point all share rank 1. "WHERE rank <= 3" would
  // return every one of them; only a LIMIT survives this.
  const tied = (
    await query<{ id: number }>(
      `INSERT INTO competitions
         (name, type, status, prize_amount, currency, winner_count,
          requires_membership, opens_at, locks_at, published_at)
       VALUES ($1,'moneyrace','finished',10,'EUR',1,false,
               now() - interval '3 hours', now() - interval '1 hour', now())
       RETURNING id`,
      [`${MARK} tied`],
    )
  )[0].id;
  for (const u of users) {
    await query(
      `INSERT INTO participants (competition_id, user_id, points, submitted_at)
       VALUES ($1, $2, 5, now())`,
      [tied, u],
    );
  }
  const tiedBoard = await competitionBoard(tied, me);
  check("twelve people tied still show three", tiedBoard.top.length, 3);
  check("...all sharing rank 1",
    tiedBoard.top.map((r) => r.rank), [1, 1, 1]);
  check("...and my own rank is 1 as well, because it is a tie",
    tiedBoard.me!.rank, 1);
  check("...with the field size honest", tiedBoard.total, PLAYERS);

  // ======================================= the all-time table, and its type
  const typeRace = await typeBoard("moneyrace", me);
  truthy("the all-time MoneyRace table has a podium", typeRace.top.length > 0);
  check("...of at most three", typeRace.top.length <= 3, true);
  check("...masked as well",
    typeRace.top.every((r) => r.name.includes("*")), true);
  check("a giveaway has no table at all",
    (await typeBoard("giveaway", me)).top.length, 0);

  // ================================================== 10,000 players, timed
  // Not an assertion - a measurement, in a transaction that is rolled back.
  const client = await pool.connect();
  let scaleMs = 0;
  let scaleTop = 0;
  let scaleRank = 0;
  let scaleTotal = 0;
  let allTimeMs = 0;
  let allTimeRows = 0;
  const BIG = 10_000;
  try {
    await client.query("BEGIN");
    const bigComp = (
      await client.query(
        `INSERT INTO competitions
           (name, type, status, prize_amount, currency, winner_count,
            requires_membership, opens_at, locks_at, published_at)
         VALUES ($1,'moneyrace','finished',100,'EUR',1,false,
                 now() - interval '3 hours', now() - interval '1 hour', now())
         RETURNING id`,
        [`${MARK} scale`],
      )
    ).rows[0].id;

    // generate_series rather than ten thousand round trips - the thing being
    // measured is the read, not the seeding.
    await client.query(
      `INSERT INTO users (telegram_id, username, first_name)
       SELECT -990000000 - g, 'scale' || g, 'Scale' || g
         FROM generate_series(1, $1) g`,
      [BIG],
    );
    await client.query(
      `INSERT INTO participants (competition_id, user_id, points, submitted_at)
       SELECT $1, u.id, (u.id % 97) + 1, now()
         FROM users u WHERE u.telegram_id <= -990000001`,
      [bigComp],
    );
    const mid = (
      await client.query(
        "SELECT id FROM users WHERE telegram_id = -990005000",
      )
    ).rows[0].id;

    // Exactly the statement competitionBoard runs, against the same client so
    // it can see the uncommitted rows.
    const sql = `
      WITH ranked AS (
        SELECT pa.user_id, pa.points, 1 AS rounds,
               RANK()   OVER (ORDER BY pa.points DESC) AS rank,
               COUNT(*) OVER ()                        AS total
          FROM participants pa
         WHERE pa.competition_id = $1
      ), top AS (SELECT * FROM ranked ORDER BY rank, user_id LIMIT $3),
         mine AS (SELECT * FROM ranked WHERE user_id = $2),
         shown AS (SELECT 'top'::text AS src, t.* FROM top t
                  UNION ALL
                  SELECT 'me'::text AS src, m.* FROM mine m)
      SELECT b.src, b.rank, b.points, b.total, u.username
        FROM shown b JOIN users u ON u.id = b.user_id
       ORDER BY (b.src = 'top') DESC, b.rank, b.user_id`;
    const started = process.hrtime.bigint();
    const res = await client.query(sql, [bigComp, mid, 3]);
    scaleMs = Number(process.hrtime.bigint() - started) / 1e6;
    scaleTop = res.rows.filter((r: any) => r.src === "top").length;
    const mineRow = res.rows.find((r: any) => r.src === "me");
    scaleRank = Number(mineRow.rank);
    scaleTotal = Number(res.rows[0].total);

    console.log(
      `      10,000 players, one competition: ${res.rows.length} rows back, ` +
        `rank #${scaleRank} of ${scaleTotal}, ${scaleMs.toFixed(1)} ms`,
    );

    // The all-time table is the heavier of the two - it groups every
    // participant row of every finished MoneyRace, not one competition's - so
    // it is the one worth timing.
    const allTimeSql = `
      WITH totals AS (
        SELECT pa.user_id, SUM(pa.points)::int AS points, COUNT(*)::int AS rounds
          FROM participants pa
          JOIN competitions c ON c.id = pa.competition_id
         WHERE c.type = $1 AND c.status IN ('finished','evaluating')
         GROUP BY pa.user_id
        HAVING SUM(pa.points) > 0
      ), ranked AS (
        SELECT user_id, points, rounds,
               RANK()   OVER (ORDER BY points DESC) AS rank,
               COUNT(*) OVER ()                     AS total
          FROM totals
      ), top AS (SELECT * FROM ranked ORDER BY rank, user_id LIMIT $3),
         mine AS (SELECT * FROM ranked WHERE user_id = $2),
         shown AS (SELECT 'top'::text AS src, t.* FROM top t
                  UNION ALL
                  SELECT 'me'::text AS src, m.* FROM mine m)
      SELECT b.src, b.rank, b.points, b.total, u.username
        FROM shown b JOIN users u ON u.id = b.user_id
       ORDER BY (b.src = 'top') DESC, b.rank, b.user_id`;
    const t2 = process.hrtime.bigint();
    const allTime = await client.query(allTimeSql, ["moneyrace", mid, 3]);
    allTimeMs = Number(process.hrtime.bigint() - t2) / 1e6;
    allTimeRows = allTime.rows.length;
    console.log(
      `      10,000 players, all-time table: ${allTimeRows} rows back, ` +
        `${allTimeMs.toFixed(1)} ms`,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }

  check("with 10,000 players the query still returns four rows",
    scaleTop + 1, 4);
  check("...and the field is counted in full", scaleTotal, BIG);
  truthy("...and a middle player gets a real position", scaleRank > 1);
  truthy(`...in ${scaleMs.toFixed(0)} ms, under half a second`, scaleMs < 500);
  check("the all-time table is four rows at that size too", allTimeRows, 4);
  truthy(`...in ${allTimeMs.toFixed(0)} ms, under half a second`, allTimeMs < 500);

  // The rollback is checked, not trusted. A leaked 10,000 users would be a
  // worse bug than anything this file is testing.
  const leaked = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM users WHERE telegram_id <= -990000001");
  check("the 10,000 test players are gone from his database", leaked?.n, 0);

  await query("DELETE FROM users WHERE telegram_id = $1", [FIRST_TG - 90]);
  await cleanup();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exitCode = 1;
  await closePool();
});
