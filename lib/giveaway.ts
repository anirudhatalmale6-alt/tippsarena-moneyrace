/**
 * Giveaways: the draw, the winner's private message, the public announcement.
 *
 * Three separate actions on purpose (his §5 and §7). Drawing decides who won.
 * Telling them is a message that can fail and be retried. Announcing it in the
 * channel is a publication he may not want to make at all. Rolling them into
 * one button would mean a failed Telegram call could roll back a draw that has
 * already happened, or a draw he wanted kept private going out anyway.
 */
import { one, query, getSetting, tx } from "./db.ts";
import { log } from "./log.ts";
import { audit } from "./admin.ts";
import { money, render } from "./templates.ts";

export interface GiveawayWinner {
  user_id: number;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  drawn_at: Date;
  pool_size: number;
  seed: string;
  prize_id: number | null;
  prize_status: string | null;
  amount: number | null;
  currency: string | null;
  notified_at: Date | null;
  notify_error: string | null;
  notes: string | null;
}

/** The winner of a giveaway, with everything the admin screen has to show. */
export async function giveawayWinner(
  competitionId: number,
): Promise<GiveawayWinner | null> {
  return one<GiveawayWinner>(
    `SELECT d.winner_user_id AS user_id, u.telegram_id, u.username, u.first_name,
            d.drawn_at, d.pool_size, d.seed,
            p.id AS prize_id, p.status AS prize_status, p.amount, p.currency,
            p.notified_at, p.notify_error, p.notes
       FROM draws d
       JOIN users u ON u.id = d.winner_user_id
       LEFT JOIN prizes p
              ON p.competition_id = d.competition_id
             AND p.user_id = d.winner_user_id
      WHERE d.competition_id = $1
      ORDER BY d.drawn_at DESC
      LIMIT 1`,
    [competitionId],
  );
}

/**
 * How a winner may be named in public.
 *
 * Username only, and only if they have one (his §7). Someone without a public
 * username is described, never identified: no Telegram id, no first name, no
 * database id. A first name is a real name, which is exactly what he said not
 * to publish.
 */
export function publicWinnerName(username: string | null): string {
  return username ? `@${username}` : "der Gewinner";
}

/**
 * Write the prize row for a drawn giveaway.
 *
 * `drawGiveaway` marks the participant; the money side is a separate row so the
 * giveaway lands in the same Winners screen as every MoneyRace payout and there
 * is one list of what he owes.
 */
export async function createGiveawayPrize(competitionId: number): Promise<void> {
  await query(
    `INSERT INTO prizes (competition_id, user_id, rank, amount, currency)
     SELECT c.id, d.winner_user_id, 1, c.prize_amount, c.currency
       FROM draws d
       JOIN competitions c ON c.id = d.competition_id
      WHERE d.competition_id = $1
        AND d.winner_user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM prizes p
                         WHERE p.competition_id = d.competition_id
                           AND p.user_id = d.winner_user_id)`,
    [competitionId],
  );
}

/** The message the winner gets, rendered. Kept here so the admin can preview it. */
export async function winnerMessage(competitionId: number) {
  const competition = await one<any>(
    "SELECT * FROM competitions WHERE id = $1",
    [competitionId],
  );
  if (!competition) throw new Error("Competition not found");
  const support = (await getSetting<string>("support_handle", "@tippsarena"))!;
  return render("giveaway_winner_dm", {
    name: competition.name,
    prize: money(competition.prize_amount, competition.currency),
    support,
  });
}

/**
 * Send the winner their private message.
 *
 * Records the outcome either way. A failure is a thing the dashboard has to
 * show and he has to be able to retry - somebody who has never started the bot
 * simply cannot be messaged by Telegram, and that is not something silence
 * should hide.
 */
export async function notifyGiveawayWinner(
  competitionId: number,
  adminUserId: number | null = null,
): Promise<{ ok: boolean; error?: string }> {
  const winner = await giveawayWinner(competitionId);
  if (!winner) throw new Error("No winner has been drawn yet");

  const message = await winnerMessage(competitionId);
  // Imported here, not at the top: this pulls in the Telegram client and only
  // this function needs it.
  const { sendToUser } = await import("../worker/announce.ts");

  const ok = await sendToUser(Number(winner.telegram_id), message, competitionId);
  const error = ok
    ? null
    : "Telegram refused the message. The winner has probably never started the bot, or has blocked it.";

  await query(
    `UPDATE prizes
        SET notified_at  = CASE WHEN $3 THEN now() ELSE notified_at END,
            notify_error = $4
      WHERE competition_id = $1 AND user_id = $2`,
    [competitionId, winner.user_id, ok, error],
  );
  await audit(
    adminUserId,
    ok ? "giveaway.notify" : "giveaway.notify_failed",
    ok
      ? "Winner told privately"
      : `Winner could not be told: ${error}`,
    "competition",
    competitionId,
  );
  log.info(`giveaway ${competitionId}: winner notification ${ok ? "sent" : "FAILED"}`);
  return ok ? { ok } : { ok, error: error! };
}

/**
 * Announce the winner in the channel.
 *
 * Which of the two templates is used is his choice per competition, and the
 * private one names nobody at all - it only says a draw happened. That is the
 * difference between proving the giveaway was real and publishing a list of
 * who entered.
 */
export async function announceGiveawayWinner(
  competitionId: number,
  adminUserId: number | null = null,
  /** Tests pass a future time so the live worker can never claim the row. */
  notBefore?: Date,
): Promise<void> {
  const competition = await one<any>(
    "SELECT * FROM competitions WHERE id = $1",
    [competitionId],
  );
  if (!competition) throw new Error("Competition not found");

  const winner = await giveawayWinner(competitionId);
  if (!winner) throw new Error("No winner has been drawn yet");

  const named = competition.announce_winner_publicly;
  const support = (await getSetting<string>("support_handle", "@tippsarena"))!;

  const message = await render(
    named ? "channel_giveaway_winner" : "channel_giveaway_winner_private",
    {
      name: competition.name,
      prize: money(competition.prize_amount, competition.currency),
      winner: publicWinnerName(winner.username),
      support,
    },
  );

  const { queueBroadcast } = await import("./broadcast.ts");
  await queueBroadcast({
    body: message.text,
    buttons: message.buttons,
    audience: "channel",
    competitionId,
    templateKey: named ? "channel_giveaway_winner" : "channel_giveaway_winner_private",
    adminUserId,
    notBefore,
  });

  await query(
    "UPDATE competitions SET winner_announced_at = now() WHERE id = $1",
    [competitionId],
  );
  await audit(
    adminUserId,
    "giveaway.announce",
    named
      ? "Winner announced in the channel, by username"
      : "Draw announced in the channel, without naming the winner",
    "competition",
    competitionId,
  );
}

/** Everyone in a giveaway. Admin only - §9 and §10 of his message. */
export interface GiveawayEntrant {
  user_id: number;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  joined_at: Date;
  is_winner: boolean;
}

export async function giveawayEntrants(
  competitionId: number,
  limit = 500,
): Promise<GiveawayEntrant[]> {
  return query<GiveawayEntrant>(
    `SELECT u.id AS user_id, u.telegram_id, u.username, u.first_name,
            pa.joined_at, pa.is_winner
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1
      ORDER BY pa.joined_at
      LIMIT $2`,
    [competitionId, limit],
  );
}

/**
 * Enter a giveaway.
 *
 * Returns whether this call is the one that added them. The database decides,
 * not a SELECT beforehand: two taps a few milliseconds apart would both find
 * "not entered" and both insert. ON CONFLICT makes the second one a no-op, and
 * `xmax = 0` is Postgres telling us which of the two rows was the insert.
 */
export async function enterGiveaway(
  competitionId: number,
  userId: number,
): Promise<{ participantId: number; isNew: boolean }> {
  const rows = await query<{ id: number; inserted: boolean }>(
    `INSERT INTO participants (competition_id, user_id, completed, submitted_at)
          VALUES ($1, $2, TRUE, now())
     ON CONFLICT (competition_id, user_id) DO UPDATE
        SET user_id = EXCLUDED.user_id
      RETURNING id, (xmax = 0) AS inserted`,
    [competitionId, userId],
  );
  return { participantId: rows[0].id, isNew: rows[0].inserted };
}
