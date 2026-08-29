/**
 * Sending the broadcasts the dashboard queued.
 *
 * Runs inside the worker so a send that takes minutes is not a web request that
 * takes minutes. Three things make it safe to run unattended:
 *
 *  - One broadcast at a time, claimed with a conditional UPDATE, so two ticks
 *    overlapping cannot both start the same one.
 *  - A batch is at most BATCH users, and the cursor moves after each message.
 *    A crash resumes at the next user rather than at the first one - nobody gets
 *    the same advert twice.
 *  - Telegram's own limit is about 30 messages a second to different people.
 *    PAUSE_MS keeps us under it; being slow is free, being rate-limited is not.
 */
import { getSetting, one, query } from "../lib/db.ts";
import { log } from "../lib/log.ts";
import type { TemplateButton } from "../lib/templates.ts";
import { sendToChannel, sendToUser } from "./announce.ts";

const BATCH = Number(process.env.BROADCAST_BATCH ?? 25);
const PAUSE_MS = Number(process.env.BROADCAST_PAUSE_MS ?? 60);

interface Job {
  id: number;
  competition_id: number | null;
  audience: string;
  body: string;
  buttons: TemplateButton[];
  cursor_user_id: string;
  channel_message_id: string | null;
  sent: number;
  failed: number;
}

const CLAIMED = `id, competition_id, audience, body, buttons,
                 cursor_user_id, channel_message_id, sent, failed`;

/**
 * Take the oldest unfinished broadcast, if nothing else has it.
 *
 * created_at <= now() is not decoration. A row dated in the future is invisible
 * here, which is what lets the test suite build a broadcast against the live
 * database without the running worker grabbing it and posting a test message to
 * real people.
 */
async function claim(): Promise<Job | null> {
  const rows = await query<Job>(
    `UPDATE broadcasts
        SET status = 'sending',
            started_at = COALESCE(started_at, now())
      WHERE id = (
        SELECT id FROM broadcasts
         WHERE status IN ('queued', 'sending')
           AND created_at <= now()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING ${CLAIMED}`,
  );
  return rows[0] ?? null;
}

/** Run one named broadcast to completion. Used by the tests. */
export async function runBroadcastById(id: number): Promise<void> {
  const rows = await query<Job>(
    `UPDATE broadcasts
        SET status = 'sending', started_at = COALESCE(started_at, now())
      WHERE id = $1 AND status IN ('queued', 'sending')
      RETURNING ${CLAIMED}`,
    [id],
  );
  const job = rows[0];
  if (!job) return;
  let more = true;
  while (more) more = await step(job);
}

async function finish(id: number, error?: string): Promise<void> {
  await query(
    `UPDATE broadcasts
        SET status = $2, finished_at = now(), error = COALESCE($3, error)
      WHERE id = $1`,
    [id, error ? "failed" : "done", error ?? null],
  );
}

/**
 * Do a slice of work on one broadcast. Returns true if there is more to do, so
 * the caller can keep going within a tick instead of waiting a whole minute
 * per batch.
 */
async function step(job: Job): Promise<boolean> {
  const wantsChannel = job.audience === "channel" || job.audience === "both";
  const wantsUsers = job.audience === "users" || job.audience === "both";

  // ---- the channel half: exactly once, ever.
  if (wantsChannel && !job.channel_message_id) {
    const channel = await getSetting<string>("channel_chat_id", null);
    if (!channel) {
      // Not a delivery failure - he simply has not connected a channel yet.
      // Leave it queued rather than burning it, unless the direct messages are
      // the real point of this broadcast, in which case carry on with those.
      if (!wantsUsers) {
        await query(
          `UPDATE broadcasts
              SET status = 'queued',
                  error = 'No channel is connected yet - waiting'
            WHERE id = $1`,
          [job.id],
        );
        return false;
      }
    } else {
      const messageId = await sendToChannel(job.competition_id, {
        text: job.body,
        buttons: job.buttons ?? [],
        parseMode: "HTML",
      });
      await query(
        "UPDATE broadcasts SET channel_message_id = $2 WHERE id = $1",
        [job.id, messageId],
      );
      job.channel_message_id = String(messageId);
      log.info(`broadcast ${job.id} posted to the channel`);
    }
  }

  if (!wantsUsers) {
    await finish(job.id);
    return false;
  }

  // ---- the direct-message half: a batch at a time, cursor first.
  const users = await query<{ id: string; telegram_id: string }>(
    `SELECT id, telegram_id FROM users
      WHERE is_blocked = FALSE AND id > $1
      ORDER BY id
      LIMIT $2`,
    [job.cursor_user_id, BATCH],
  );

  if (!users.length) {
    await finish(job.id);
    log.info(
      `broadcast ${job.id} done: ${job.sent} delivered, ${job.failed} could not be reached`,
    );
    return false;
  }

  for (const user of users) {
    const ok = await sendToUser(
      Number(user.telegram_id),
      { text: job.body, buttons: job.buttons ?? [], parseMode: "HTML" },
      job.competition_id,
    );
    // Cursor and counter move together, in one statement: a process killed
    // between the two would otherwise either re-send or lose count.
    await query(
      `UPDATE broadcasts
          SET cursor_user_id = $2,
              sent   = sent   + $3,
              failed = failed + $4
        WHERE id = $1`,
      [job.id, user.id, ok ? 1 : 0, ok ? 0 : 1],
    );
    job.cursor_user_id = user.id;
    if (ok) job.sent += 1;
    else job.failed += 1;
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  return true;
}

/** Called once per worker tick. Sends until the queue is empty or it errors. */
export async function runBroadcasts(): Promise<void> {
  // A broadcast waiting for a channel that has not been connected yet goes back
  // to 'queued', which claim() would hand straight back. Remembering what this
  // tick has already picked up turns that into "try again next minute" instead
  // of a loop that never ends.
  const seen = new Set<number>();
  for (;;) {
    const job = await claim();
    if (!job || seen.has(job.id)) return;
    seen.add(job.id);
    try {
      let more = true;
      while (more) more = await step(job);
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      log.error(`broadcast ${job.id} failed`, err);
      await finish(job.id, message);
    }
  }
}

/** How many are waiting - shown in the dashboard so a stuck queue is visible. */
export async function pendingBroadcasts(): Promise<number> {
  const row = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM broadcasts WHERE status IN ('queued','sending')",
  );
  return row?.n ?? 0;
}
