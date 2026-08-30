/**
 * Whether a queued announcement is still worth sending.
 *
 * The worker queues announcements ahead of time - that is the whole point of a
 * queue - which means every one of them is a claim about a competition made
 * before the fact. Between the queueing and the due time the competition can
 * open, lock, be drawn, be scored, finish, or be put back to a draft. The
 * sender used to check only "is it due, and has it been sent", so a message
 * that had stopped being true went out exactly as written.
 *
 * That is not hypothetical. Giveaway 57 was drawn and its winner announced on
 * 29 Aug; its reminder was due 30 Aug 10:17 and posted
 * "Noch 1 Stunde! Deine Tipps abgeben!" into the channel, for a giveaway that
 * has no tips and had been over for 22 hours.
 *
 * The rules are pure - no database, no clock beyond the `now` handed in - so
 * they can be tested against every combination instead of against whichever
 * ones happen to exist in his data.
 */
import { query } from "./db.ts";

export type NotificationKind = "opened" | "reminder" | "locked" | "winner" | string;

export interface CompetitionState {
  type: string;
  status: string;
  locks_at: Date | string | null;
}

/**
 * Does this kind of announcement mean anything for this kind of competition?
 *
 * A giveaway has no matches, no tips and no Tippschluss - that rule is already
 * enforced in the bot and on every dashboard screen, and this is the same rule
 * for the channel. A "one hour left to tip" or a "closed for tips" post about
 * a giveaway is wrong the moment it is written, not merely stale.
 */
export function notificationApplies(type: string, kind: NotificationKind): boolean {
  if (type === "giveaway" && (kind === "reminder" || kind === "locked")) return false;
  return true;
}

export interface Freshness {
  ok: boolean;
  /** Present when ok is false. Stored on the row and shown in the dashboard. */
  reason?: string;
}

/**
 * Is this announcement still true, right now?
 *
 * Deliberately strict: when the state does not match what the message says,
 * the answer is no. An announcement that cannot be sent is a missing post,
 * which he can see and send by hand; an announcement that is sent when it is
 * false cannot be taken back - it has already been read.
 */
export function notificationStillTrue(
  kind: NotificationKind,
  competition: CompetitionState,
  now: Date = new Date(),
): Freshness {
  if (!notificationApplies(competition.type, kind)) {
    return {
      ok: false,
      reason: `a ${competition.type} has no Tippschluss, so a "${kind}" announcement does not apply to it`,
    };
  }

  const locksAt = competition.locks_at ? new Date(competition.locks_at) : null;

  switch (kind) {
    case "opened":
      // Announcing an opening after the thing has locked sends people to a
      // door that is already shut. This is the same reason the queue dates it
      // for opens_at rather than for now.
      return competition.status === "open"
        ? { ok: true }
        : { ok: false, reason: `it is "${competition.status}", not open` };

    case "reminder":
      if (competition.status !== "open") {
        return { ok: false, reason: `it is "${competition.status}", not open` };
      }
      if (!locksAt) return { ok: false, reason: "it has no Tippschluss" };
      if (locksAt.getTime() <= now.getTime()) {
        return { ok: false, reason: "the Tippschluss has already passed" };
      }
      return { ok: true };

    case "locked":
      return ["locked", "evaluating", "finished"].includes(competition.status)
        ? { ok: true }
        : { ok: false, reason: `it is "${competition.status}", not closed` };

    case "winner":
      return competition.status === "finished"
        ? { ok: true }
        : { ok: false, reason: `it is "${competition.status}", not finished` };

    default:
      return { ok: true };
  }
}

// ------------------------------------------------------------------ storage

/**
 * Retire whatever is still queued for a competition that has just ended.
 *
 * The send-time check is what actually guarantees nothing false goes out; this
 * is so the operator does not see a reminder sitting in "Queued announcements"
 * for a competition he has already drawn, wondering whether it is about to
 * post. `winner` is excluded because the finish queues it immediately after.
 */
export async function cancelPendingNotifications(
  competitionId: number,
  reason: string,
): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE notifications
        SET skipped_at = now(), skip_reason = $2
      WHERE competition_id = $1
        AND sent_at IS NULL
        AND skipped_at IS NULL
        AND kind <> 'winner'
      RETURNING id`,
    [competitionId, reason],
  );
  return rows.length;
}
