/**
 * What a player is allowed to see of the standings.
 *
 * His rule, verbatim: "The leaderboard must NOT display every user. Even if
 * there are 1,000+ participants, only show [the top 3] and [their own
 * position]." Plus: names in it are masked.
 *
 * That is two requirements, and only one of them is about privacy:
 *
 *   PRIVACY  a player learns three masked names and their own rank. Nothing
 *            else about anybody. This is different from the winner
 *            announcement in the channel, which names the winner in full on
 *            purpose - a leaderboard is not a result.
 *
 *   SIZE     the query must not grow with the number of players. The old one
 *            pulled fifteen rows and would have pulled fifteen out of ten
 *            thousand happily enough, but "my position" cannot be answered
 *            that way at all: to know you are #499 something has to count the
 *            498 people above you. That counting happens in Postgres, in one
 *            statement, and at most four rows come back.
 *
 * Both boards - the all-time table per type, and the standings inside one
 * competition - are built from the same shape, so there is one place where the
 * rule "top 3 and you" lives and one place where it can be got wrong.
 */
import { query } from "./db.ts";
import { plural } from "./messagevars.ts";

export interface BoardRow {
  rank: number;
  /** Already masked. Never a raw username. */
  name: string;
  points: number;
  rounds: number;
  isMe: boolean;
}

export interface Board {
  /** At most `topSize` rows, whatever the size of the field. */
  top: BoardRow[];
  /** The asking player, or null when they have no points / have not played. */
  me: BoardRow | null;
  /** How many people are ranked at all. */
  total: number;
  /** Whether `me` is already one of `top` - so it is not printed twice. */
  meInTop: boolean;
}

export const TOP_SIZE = 3;

/**
 * `yannick` -> `y*****`, `max` -> `m***`, `greta` -> `g****`.
 *
 * His examples keep the first letter and replace the rest, which also leaks the
 * length - harmless for a seven-letter name, less so for a two-letter one, so
 * there are never fewer than three stars and never more than eight. A name is
 * therefore never reconstructable from its mask, and the line never runs off
 * the side of a phone.
 */
export function maskName(
  username: string | null,
  firstName: string | null = null,
): string {
  const source = (username ?? firstName ?? "").trim();
  if (!source) return "Spieler";
  const head = [...source][0]!;
  const rest = [...source].length - 1;
  const stars = Math.min(8, Math.max(3, rest));
  return head + "*".repeat(stars);
}

interface RawRow {
  src: "top" | "me";
  rank: string | number;
  points: number;
  rounds: number;
  total: string | number;
  user_id: number;
  username: string | null;
  first_name: string | null;
}

/**
 * Turn the (at most four) rows Postgres returned into a board.
 *
 * The "me" row is looked for by user id rather than by a flag on the top rows,
 * because a player can be both in the top three and the one asking, and the
 * display wants to know that rather than guess.
 */
function assemble(rows: RawRow[], meUserId: number | null): Board {
  const total = rows.length ? Number(rows[0]!.total) : 0;
  const toRow = (r: RawRow): BoardRow => ({
    rank: Number(r.rank),
    name: maskName(r.username, r.first_name),
    points: r.points,
    rounds: r.rounds,
    isMe: meUserId !== null && r.user_id === meUserId,
  });

  const top = rows.filter((r) => r.src === "top").map(toRow);
  const mineRow = rows.find((r) => r.src === "me");
  const me = mineRow ? toRow(mineRow) : null;
  return {
    top,
    me,
    total,
    meInTop: me !== null && top.some((r) => r.rank === me.rank && r.isMe),
  };
}

/**
 * The all-time table for one competition type.
 *
 * MoneyRace points and Exact Score points are never summed together (his §8);
 * `type` is the whole reason this takes an argument. Giveaways award no points
 * and so cannot appear here at all.
 *
 * The two halves - the podium and your row - are cut from the SAME ranked set
 * in ONE statement. Asking twice would let a competition finish in between and
 * show you a rank that disagreed with the podium above it.
 */
export async function typeBoard(
  type: string,
  meUserId: number | null,
  topSize = TOP_SIZE,
): Promise<Board> {
  const rows = await query<RawRow>(
    `WITH totals AS (
        SELECT pa.user_id,
               SUM(pa.points)::int AS points,
               COUNT(*)::int       AS rounds
          FROM participants pa
          JOIN competitions c ON c.id = pa.competition_id
         WHERE c.type = $1
           AND c.status IN ('finished', 'evaluating')
         GROUP BY pa.user_id
        HAVING SUM(pa.points) > 0
     ), ranked AS (
        SELECT user_id, points, rounds,
               RANK()     OVER (ORDER BY points DESC) AS rank,
               COUNT(*)   OVER ()                     AS total
          FROM totals
     ), top AS (
        -- LIMIT, not "WHERE rank <= 3". With a thousand players tied on one
        -- point the whole thousand share rank 1, and a rank filter would
        -- return every one of them.
        SELECT * FROM ranked ORDER BY rank, user_id LIMIT $3
     ), mine AS (
        SELECT * FROM ranked WHERE user_id = $2
     ), shown AS (
        SELECT 'top'::text AS src, t.* FROM top t
        UNION ALL
        SELECT 'me'::text  AS src, m.* FROM mine m
     )
     SELECT b.src, b.rank, b.points, b.rounds, b.total, b.user_id,
            u.username, u.first_name
       FROM shown b
       JOIN users u ON u.id = b.user_id
      ORDER BY (b.src = 'top') DESC, b.rank, b.user_id`,
    [type, meUserId ?? 0, topSize],
  );
  return assemble(rows, meUserId);
}

/**
 * The standings inside one competition, same shape and same limits.
 *
 * The rank is computed rather than read from participants.rank so that this
 * also works while a competition is still running, before anything has been
 * evaluated. Ties share a rank, which they must: he asked for tied exact-score
 * players to split the prize, so a table that hid the tie would contradict the
 * payout.
 */
export async function competitionBoard(
  competitionId: number,
  meUserId: number | null,
  topSize = TOP_SIZE,
): Promise<Board> {
  const rows = await query<RawRow>(
    `WITH ranked AS (
        SELECT pa.user_id, pa.points, 1 AS rounds,
               RANK()   OVER (ORDER BY pa.points DESC) AS rank,
               COUNT(*) OVER ()                        AS total
          FROM participants pa
         WHERE pa.competition_id = $1
     ), top AS (
        SELECT * FROM ranked ORDER BY rank, user_id LIMIT $3
     ), mine AS (
        SELECT * FROM ranked WHERE user_id = $2
     ), shown AS (
        SELECT 'top'::text AS src, t.* FROM top t
        UNION ALL
        SELECT 'me'::text  AS src, m.* FROM mine m
     )
     SELECT b.src, b.rank, b.points, b.rounds, b.total, b.user_id,
            u.username, u.first_name
       FROM shown b
       JOIN users u ON u.id = b.user_id
      ORDER BY (b.src = 'top') DESC, b.rank, b.user_id`,
    [competitionId, meUserId ?? 0, topSize],
  );
  return assemble(rows, meUserId);
}

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Render a board for Telegram.
 *
 * The player's own line is always printed, separated by a rule, even when they
 * are already in the top three - "where am I" is the question the screen exists
 * to answer, and it should not need reading the podium to find out.
 */
export function boardText(board: Board, title: string, empty: string): string {
  if (!board.top.length) return `🏆 <b>${title}</b>\n\n${empty}`;

  const lines = board.top.map((row, i) => {
    const medal = MEDALS[i] ?? `${row.rank}.`;
    const you = row.isMe ? " 👈" : "";
    return `${medal} ${row.rank}. ${row.name} — ${plural(row.points, "Punkt", "Punkte")}${you}`;
  });

  const mine = board.me
    ? `👤 <b>Deine Platzierung: #${board.me.rank}</b>\n` +
      `<b>Du — ${plural(board.me.points, "Punkt", "Punkte")}</b>`
    : "👤 <b>Du bist noch nicht platziert.</b>\n" +
      "Mach bei einem Wettbewerb mit und sammle Punkte!";

  const footer =
    board.total > board.top.length
      ? `\n\n<i>${plural(board.total, "Teilnehmer", "Teilnehmer")} in der Wertung.</i>`
      : "";

  return (
    `🏆 <b>${title}</b>\n\n` +
    lines.join("\n") +
    `\n\n─────────\n\n` +
    mine +
    footer
  );
}
