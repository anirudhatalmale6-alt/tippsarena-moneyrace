/**
 * The worker (spec §36). Everything that has to happen without the operator
 * touching anything:
 *
 *   open a competition when its time comes
 *   lock predictions at the lock time
 *   pull results in after kick-off
 *   score, rank, and mark winners
 *   send the channel announcements that are due
 *
 * All state lives in the database, never in a timer. The process can be
 * restarted at any second of any of these steps and the next tick picks up
 * exactly where it was - which is the only way an unattended system is safe.
 */
import { config } from "../lib/config.ts";
import { getSetting, one, query } from "../lib/db.ts";
import { log } from "../lib/log.ts";
import { evaluateCompetition } from "../lib/competitions.ts";
import { refreshPendingResults } from "../lib/fixtures.ts";
import { render } from "../lib/templates.ts";
import { announcementTemplate, competitionVars } from "../lib/messagevars.ts";
import { notifyCompetitionWinners, publicResult } from "../lib/winners.ts";
import { sendToChannel } from "./announce.ts";
import { runBroadcasts } from "./broadcast.ts";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 60_000);

/** draft -> open, once opens_at has passed and it has been published. */
async function openDue(): Promise<void> {
  const rows = await query<{ id: number; name: string }>(
    `UPDATE competitions
        SET status = 'open', updated_at = now()
      WHERE status = 'draft'
        AND published_at IS NOT NULL
        AND opens_at IS NOT NULL AND opens_at <= now()
      RETURNING id, name`,
  );
  for (const row of rows) log.info(`competition ${row.id} "${row.name}" is now open`);
}

/**
 * open -> locked, on the clock.
 *
 * The bot refuses a late prediction by comparing against locks_at directly, so
 * this is bookkeeping rather than the lock itself - nothing can slip through in
 * the seconds between the lock time and this tick.
 */
async function lockDue(): Promise<void> {
  const rows = await query<{ id: number; name: string }>(
    `UPDATE competitions
        SET status = 'locked', locked_at = now(), updated_at = now()
      WHERE status = 'open'
        AND locks_at IS NOT NULL AND locks_at <= now()
      RETURNING id, name`,
  );
  for (const row of rows) {
    log.info(`competition ${row.id} "${row.name}" locked`);
    const count = await one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM participants WHERE competition_id = $1",
      [row.id],
    );
    await queueNotification(row.id, "locked", new Date());
    await query(
      `UPDATE notifications SET due_at = now() WHERE competition_id = $1 AND kind = 'locked'`,
      [row.id],
    );
    log.info(`  ${count?.n ?? 0} participants`);
  }
}

/** Score everything that is locked and has results, over and over until final. */
async function evaluateDue(): Promise<void> {
  const rows = await query<{ id: number; name: string; winner_count: number }>(
    `SELECT id, name, winner_count FROM competitions
      WHERE status IN ('locked','evaluating')
        AND type <> 'giveaway'`,
  );

  for (const competition of rows) {
    try {
      const outcome = await evaluateCompetition(competition.id);

      if (!outcome.complete) {
        // Spec §37: say it is pending, do not name a winner.
        await query(
          `UPDATE competitions SET status = 'evaluating', updated_at = now()
            WHERE id = $1 AND status <> 'evaluating'`,
          [competition.id],
        );
        continue;
      }

      await query(
        `UPDATE competitions
            SET status = 'finished', evaluated_at = now(), updated_at = now()
          WHERE id = $1`,
        [competition.id],
      );
      await createPrizes(competition.id);
      // The winner is told privately no matter what the channel does - his §6,
      // and the one message that must never depend on a setting.
      try {
        await notifyCompetitionWinners(competition.id, null);
      } catch (err) {
        log.error(`could not tell the winner of ${competition.id}`, err);
      }
      // NO "results" notification. That was the full leaderboard, by username,
      // into a public channel, automatically. Only the winner announcement is
      // queued now, and what it says obeys public_result_mode.
      await queueNotification(competition.id, "winner", new Date());
      log.info(`competition ${competition.id} "${competition.name}" finished`);
    } catch (err) {
      log.error(`evaluation of competition ${competition.id} failed`, err);
    }
  }
}

/**
 * Write a prize row per winner, unpaid.
 *
 * The system never moves money (spec §29) - this is the list of what he owes,
 * and he marks each one paid by hand.
 */
async function createPrizes(competitionId: number): Promise<void> {
  await query(
    `INSERT INTO prizes (competition_id, user_id, rank, amount, currency)
     SELECT c.id, pa.user_id, pa.rank,
            CASE WHEN COUNT(*) OVER () > 0
                 THEN ROUND(c.prize_amount / COUNT(*) OVER (), 2)
                 ELSE 0 END,
            c.currency
       FROM participants pa
       JOIN competitions c ON c.id = pa.competition_id
      WHERE pa.competition_id = $1
        AND pa.is_winner = TRUE
        AND NOT EXISTS (SELECT 1 FROM prizes p
                         WHERE p.competition_id = pa.competition_id
                           AND p.user_id = pa.user_id)`,
    [competitionId],
  );
}

async function queueNotification(
  competitionId: number,
  kind: string,
  dueAt: Date,
): Promise<void> {
  await query(
    `INSERT INTO notifications (competition_id, kind, due_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (competition_id, kind, audience) DO NOTHING`,
    [competitionId, kind, dueAt],
  );
}

let warnedAboutChannel = false;

/** Send whatever announcements have come due, one at a time, then mark them. */
async function sendDueNotifications(): Promise<void> {
  // A channel that has not been configured yet is not a delivery failure, and
  // it must not eat the retry budget: publish five competitions before setting
  // the channel and all five announcements would give up for good. Skip
  // instead, and say so once rather than every minute.
  const channel = await getSetting<string>("channel_chat_id", null);
  if (!channel) {
    if (!warnedAboutChannel) {
      const waiting = await one<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM notifications WHERE sent_at IS NULL AND due_at <= now()",
      );
      log.warn(
        `channel_chat_id is not set - ${waiting?.n ?? 0} announcement(s) are ` +
          `waiting and will go out as soon as it is`,
      );
      warnedAboutChannel = true;
    }
    return;
  }
  warnedAboutChannel = false;

  const due = await query<{
    id: number;
    competition_id: number;
    kind: string;
    attempts: number;
  }>(
    `SELECT id, competition_id, kind, attempts FROM notifications
      WHERE sent_at IS NULL AND due_at <= now() AND attempts < 5
      ORDER BY due_at
      LIMIT 10`,
  );

  for (const notification of due) {
    await query(
      "UPDATE notifications SET attempts = attempts + 1 WHERE id = $1",
      [notification.id],
    );
    try {
      await sendCompetitionMessage(notification.competition_id, notification.kind);
      await query("UPDATE notifications SET sent_at = now() WHERE id = $1", [
        notification.id,
      ]);
    } catch (err) {
      // Kept, not dropped: five attempts and then it sits in the dashboard as
      // a failure the operator can retry (spec §37).
      await query("UPDATE notifications SET last_error = $2 WHERE id = $1", [
        notification.id,
        String(err instanceof Error ? err.message : err),
      ]);
      log.error(
        `notification ${notification.kind} for competition ${notification.competition_id} failed`,
        err,
      );
    }
  }
}

async function sendCompetitionMessage(
  competitionId: number,
  kind: string,
): Promise<void> {
  const competition = await one<{ type: string }>(
    "SELECT type FROM competitions WHERE id = $1",
    [competitionId],
  );
  if (!competition) throw new Error(`competition ${competitionId} is gone`);

  // The template follows the TYPE as well as the kind: a giveaway announced
  // with the MoneyRace text says "0 Spiele, 0 Tipps", which is how it looked
  // broken in the first place.
  // A finished competition goes through publicResult(), which is the ONLY
  // thing allowed to decide who gets named in the channel. Everything else
  // keeps the ordinary template path.
  if (kind === "winner") {
    const result = await publicResult(competitionId);
    if (!result.templateKey) {
      log.info(
        `competition ${competitionId}: public results are off, or there is no ` +
          `winner to name - nothing posted`,
      );
      return;
    }
    const message = await render(result.templateKey, result.vars);
    await sendToChannel(competitionId, message);
    return;
  }

  const templateKey = announcementTemplate(competition.type, kind);
  const message = await render(templateKey, await competitionVars(competitionId));
  await sendToChannel(competitionId, message);
}

// --------------------------------------------------------------- main loop
async function tick(): Promise<void> {
  await openDue();
  await lockDue();

  try {
    await refreshPendingResults();
  } catch (err) {
    // The provider being down is not this loop's problem to solve. Nothing is
    // written, the competition stays where it is, and the next tick tries again.
    log.error("result refresh failed - leaving all data untouched", err);
  }

  await evaluateDue();
  await sendDueNotifications();

  try {
    await runBroadcasts();
  } catch (err) {
    // A broadcast that cannot go out must not stop competitions from opening,
    // locking or being scored on the next tick.
    log.error("broadcast queue failed", err);
  }
}

async function main(): Promise<void> {
  log.info(`worker starting, tick every ${TICK_MS / 1000}s`);
  for (;;) {
    try {
      await tick();
    } catch (err) {
      log.error("tick failed", err);
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error("worker died", err);
    process.exit(1);
  });
}

export { tick, openDue, lockDue, evaluateDue, sendDueNotifications, createPrizes, runBroadcasts };
