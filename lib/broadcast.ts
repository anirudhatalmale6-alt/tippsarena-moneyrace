/**
 * Queue a message for the channel, for every bot user, or both.
 *
 * The dashboard writes rows here; worker/broadcast.ts does the sending. Nothing
 * in this file talks to Telegram, so it can be called from a server action
 * without pulling the Telegram client into the web process.
 */
import { one, query } from "./db.ts";
import type { TemplateButton } from "./templates.ts";

export type Audience = "channel" | "users" | "both";

export const AUDIENCES: Array<[Audience, string]> = [
  ["channel", "Channel only"],
  ["users", "Everyone who started the bot (direct message)"],
  ["both", "Channel and direct message"],
];

export interface QueuedBroadcast {
  id: number;
  recipients: number;
}

/**
 * How many people a "users" broadcast would reach.
 *
 * Anyone we have already found to be unreachable is left out of the count, so
 * the number he sees before sending is the number he can expect afterwards
 * rather than a total that always looks like it half failed.
 */
export async function audienceSize(): Promise<number> {
  const row = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM users WHERE is_blocked = FALSE",
  );
  return row?.n ?? 0;
}

export async function queueBroadcast(input: {
  body: string;
  audience: Audience;
  buttons?: TemplateButton[];
  competitionId?: number | null;
  templateKey?: string | null;
  adminUserId?: number | null;
}): Promise<QueuedBroadcast> {
  const body = input.body.trim();
  if (!body) throw new Error("The message is empty - nothing was sent");

  const recipients =
    input.audience === "channel" ? 0 : await audienceSize();

  const rows = await query<{ id: number }>(
    `INSERT INTO broadcasts
       (competition_id, audience, template_key, body, buttons, recipients, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      input.competitionId ?? null,
      input.audience,
      input.templateKey ?? null,
      body,
      JSON.stringify(input.buttons ?? []),
      recipients,
      input.adminUserId ?? null,
    ],
  );
  return { id: rows[0].id, recipients };
}

export interface BroadcastRow {
  id: number;
  audience: Audience;
  status: string;
  body: string;
  recipients: number;
  sent: number;
  failed: number;
  error: string | null;
  competition: string | null;
  created_at: Date;
  finished_at: Date | null;
}

export async function recentBroadcasts(limit = 15): Promise<BroadcastRow[]> {
  return query<BroadcastRow>(
    `SELECT b.id, b.audience, b.status, left(b.body, 160) AS body,
            b.recipients, b.sent, b.failed, b.error, b.created_at, b.finished_at,
            c.name AS competition
       FROM broadcasts b
       LEFT JOIN competitions c ON c.id = b.competition_id
      ORDER BY b.created_at DESC
      LIMIT $1`,
    [limit],
  );
}
