/**
 * What the public website is allowed to know.
 *
 * The three pages under tippsarena.com read through here and nowhere else, so
 * there is exactly one place that decides what leaves the database. Nothing in
 * this file returns a Telegram id, a full username, or a real name.
 */
import { query, getSetting } from "./db.ts";

/**
 * A player's name for a public page: first character, then six stars.
 *
 * His instruction, 29 Aug: "without the full username of course only first
 * letter and then ******". The star count is fixed rather than matching the
 * length of the name, because a variable length leaks how long it was.
 */
export function maskName(
  username: string | null,
  firstName: string | null,
): string {
  const source = (username ?? firstName ?? "").trim();
  if (!source) return "A******";
  return `${source[0].toUpperCase()}******`;
}

export interface PublicRow {
  rank: number | null;
  name: string;
  points: number;
  correct: number;
}

export interface PublicBoard {
  id: number;
  name: string;
  status: string;
  prize_amount: number;
  currency: string;
  locks_at: Date | null;
  participants: number;
  rows: PublicRow[];
}

/** Every competition that is worth showing, newest first, with its top 15. */
export async function publicBoards(limit = 12): Promise<PublicBoard[]> {
  const competitions = await query<{
    id: number; name: string; status: string;
    prize_amount: number; currency: string; locks_at: Date | null;
    participants: number;
  }>(
    `SELECT c.id, c.name, c.status, c.prize_amount, c.currency, c.locks_at,
            (SELECT COUNT(*)::int FROM participants p WHERE p.competition_id = c.id) AS participants
       FROM competitions c
      WHERE c.status IN ('open','locked','evaluating','finished')
        AND c.published_at IS NOT NULL
      ORDER BY COALESCE(c.locks_at, c.created_at) DESC
      LIMIT $1`,
    [limit],
  );

  const boards: PublicBoard[] = [];
  for (const competition of competitions) {
    const rows = await query<{
      rank: number | null; username: string | null; first_name: string | null;
      points: number; correct_count: number;
    }>(
      `SELECT pa.rank, u.username, u.first_name, pa.points, pa.correct_count
         FROM participants pa JOIN users u ON u.id = pa.user_id
        WHERE pa.competition_id = $1
        ORDER BY pa.rank NULLS LAST, pa.points DESC, pa.submitted_at NULLS LAST, pa.id
        LIMIT 15`,
      [competition.id],
    );
    boards.push({
      ...competition,
      rows: rows.map((row) => ({
        rank: row.rank,
        name: maskName(row.username, row.first_name),
        points: row.points,
        correct: row.correct_count,
      })),
    });
  }
  return boards;
}

/** The all-time table, over finished competitions only. */
export async function publicAllTime(limit = 20): Promise<PublicRow[]> {
  const rows = await query<{
    username: string | null; first_name: string | null;
    points: number; correct_count: number;
  }>(
    `SELECT u.username, u.first_name,
            SUM(pa.points)::int AS points,
            SUM(pa.correct_count)::int AS correct_count
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
       JOIN competitions c ON c.id = pa.competition_id
      WHERE c.status = 'finished'
      GROUP BY u.id, u.username, u.first_name
      ORDER BY points DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row, i) => ({
    rank: i + 1,
    name: maskName(row.username, row.first_name),
    points: row.points,
    correct: row.correct_count,
  }));
}

export interface PublicStats {
  players: number;
  competitions_finished: number;
  prize_open: number;
  prize_paid: number;
  currency: string;
}

/**
 * Counted, never estimated.
 *
 * A landing page that quotes a number has to be able to point at the row it
 * came from - these are the same tables the dashboard reads.
 */
export async function publicStats(): Promise<PublicStats> {
  const [row] = await query<PublicStats>(
    `SELECT
       (SELECT COUNT(*)::int FROM users)                                    AS players,
       (SELECT COUNT(*)::int FROM competitions WHERE status = 'finished')   AS competitions_finished,
       (SELECT COALESCE(SUM(prize_amount),0) FROM competitions
         WHERE status IN ('open','locked','evaluating'))                    AS prize_open,
       (SELECT COALESCE(SUM(amount),0) FROM prizes WHERE status = 'paid')   AS prize_paid,
       'EUR'::text                                                          AS currency`,
  );
  return row;
}

/** The competition an ad should point at: the one that is open and locks next. */
export async function nextCompetition(): Promise<{
  id: number; name: string; prize_amount: number; currency: string;
  locks_at: Date | null; participants: number;
} | null> {
  const rows = await query<any>(
    `SELECT c.id, c.name, c.prize_amount, c.currency, c.locks_at,
            (SELECT COUNT(*)::int FROM participants p WHERE p.competition_id = c.id) AS participants
       FROM competitions c
      WHERE c.status = 'open' AND c.published_at IS NOT NULL
      ORDER BY c.locks_at NULLS LAST
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** t.me link to the bot, carrying the campaign code the analytics page groups by. */
export async function botLink(campaign: string): Promise<string> {
  const username =
    (await getSetting<string>("bot_username", "TippsArenaMoneyrace_bot")) ??
    "TippsArenaMoneyrace_bot";
  return `https://t.me/${username}?start=${campaign}`;
}

export async function channelLink(): Promise<string | null> {
  return await getSetting<string>("channel_invite_url", null);
}
