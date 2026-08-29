/**
 * The operations behind the dashboard (spec §13, §14, §16, §17, §27, §29).
 *
 * They live here rather than inside the web layer so the same code runs from a
 * button, from a script and from a test - and so every one of them writes an
 * audit row, which is the point of §35.
 */
import { one, query, tx } from "./db.ts";
import { log } from "./log.ts";
import { upsertFixtures } from "./fixtures.ts";
import { fixturesByLeagueRange } from "./football.ts";
import type { FixtureRow } from "./football.ts";

export async function audit(
  adminUserId: number | null,
  action: string,
  summary: string,
  entity?: string,
  entityId?: string | number,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (admin_user_id, action, entity, entity_id, summary, before_state, after_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      adminUserId,
      action,
      entity ?? null,
      entityId !== undefined ? String(entityId) : null,
      summary,
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after),
    ],
  );
}

// ---------------------------------------------------------------- fixtures
export interface ImportResult {
  fetched: number;
  stored: number;
  fixtures: Array<{ id: number; row: FixtureRow }>;
}

/**
 * Pull a league's matches for a date range into the fixtures table.
 *
 * Nothing is deleted and nothing already stored is emptied - an import only
 * ever adds or refreshes (spec §37).
 */
export async function importFixtures(
  leagueId: number,
  season: number,
  from: string,
  to: string,
  adminUserId: number | null = null,
): Promise<ImportResult> {
  const rows = await fixturesByLeagueRange(leagueId, season, from, to);
  const ids = await upsertFixtures(rows);
  await audit(
    adminUserId,
    "fixtures.import",
    `${rows.length} matches imported (league ${leagueId}, ${from} to ${to})`,
    "league",
    leagueId,
  );
  return {
    fetched: rows.length,
    stored: ids.length,
    fixtures: ids.map((id, i) => ({ id, row: rows[i] })),
  };
}

// ---------------------------------------------------------------- competitions
export interface NewCompetition {
  name: string;
  type?: string;
  description?: string | null;
  prizeAmount?: number;
  currency?: string;
  winnerCount?: number;
  requiresMembership?: boolean;
  opensAt?: Date | null;
  locksAt?: Date | null;
  endsAt?: Date | null;
  scoring?: Record<string, number>;
  tiebreakers?: string[];
  templateId?: number | null;
  jackpotAmount?: number | null;
  jackpotIncrement?: number | null;
}

export async function createCompetition(
  input: NewCompetition,
  adminUserId: number | null = null,
): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO competitions
       (name, type, description, prize_amount, currency, winner_count,
        requires_membership, opens_at, locks_at, ends_at, scoring, tiebreakers,
        template_id, jackpot_amount, jackpot_increment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             COALESCE($11::jsonb, '{"correct_outcome":1,"exact_score":0}'::jsonb),
             COALESCE($12::jsonb, '["points","exact_hits","submitted_at"]'::jsonb),
             $13,$14,$15,$16)
     RETURNING id`,
    [
      input.name,
      input.type ?? "moneyrace",
      input.description ?? null,
      input.prizeAmount ?? 0,
      input.currency ?? "EUR",
      input.winnerCount ?? 1,
      input.requiresMembership ?? true,
      input.opensAt ?? null,
      input.locksAt ?? null,
      input.endsAt ?? null,
      input.scoring ? JSON.stringify(input.scoring) : null,
      input.tiebreakers ? JSON.stringify(input.tiebreakers) : null,
      input.templateId ?? null,
      input.jackpotAmount ?? null,
      input.jackpotIncrement ?? null,
      adminUserId,
    ],
  );
  const id = rows[0].id;
  await audit(adminUserId, "competition.create", `Competition "${input.name}" created`,
    "competition", id, undefined, input);
  log.info(`competition ${id} "${input.name}" created`);
  return id;
}

/** Replace the whole match list of a competition, in the given order. */
export async function setCompetitionFixtures(
  competitionId: number,
  fixtureIds: number[],
  adminUserId: number | null = null,
): Promise<void> {
  await tx(async (client) => {
    const { rows } = await client.query(
      "SELECT status FROM competitions WHERE id = $1 FOR UPDATE",
      [competitionId],
    );
    // Changing the matches of a locked competition would invalidate every
    // prediction already made. Refused outright rather than half-applied.
    if (rows[0] && !["draft", "open"].includes(rows[0].status)) {
      throw new Error(
        `Matches can only be changed while the competition is a draft or still open (status: ${rows[0].status})`,
      );
    }
    await client.query(
      "DELETE FROM competition_fixtures WHERE competition_id = $1",
      [competitionId],
    );
    let position = 1;
    for (const fixtureId of fixtureIds) {
      await client.query(
        `INSERT INTO competition_fixtures (competition_id, fixture_id, position)
         VALUES ($1, $2, $3)`,
        [competitionId, fixtureId, position],
      );
      position += 1;
    }
  });
  await audit(adminUserId, "competition.fixtures",
    `${fixtureIds.length} matches assigned`, "competition", competitionId);
}

/** Move a draft to published so the worker will open it (spec §14). */
export async function publishCompetition(
  competitionId: number,
  adminUserId: number | null = null,
): Promise<void> {
  const competition = await one<{
    id: number; name: string; status: string; locks_at: Date | null; matches: number;
  }>(
    `SELECT c.id, c.name, c.status, c.locks_at,
            (SELECT COUNT(*)::int FROM competition_fixtures cf
              WHERE cf.competition_id = c.id) AS matches
       FROM competitions c WHERE c.id = $1`,
    [competitionId],
  );
  if (!competition) throw new Error("Competition not found");
  if (!competition.locks_at) throw new Error("Cannot publish without a lock time");
  // A giveaway has no matches by design; anything else without matches would
  // publish an empty competition to the channel.
  const type = await one<{ type: string }>(
    "SELECT type FROM competitions WHERE id = $1", [competitionId]);
  if (type?.type !== "giveaway" && competition.matches === 0) {
    throw new Error("Cannot publish without any matches");
  }

  await query(
    `UPDATE competitions
        SET published_at = COALESCE(published_at, now()),
            opens_at = COALESCE(opens_at, now()),
            status = CASE WHEN status = 'draft' THEN 'open' ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [competitionId],
  );
  // The announcement is queued, not sent here: one place sends to Telegram, and
  // it retries. A failed publish must not leave a competition half-open.
  await query(
    `INSERT INTO notifications (competition_id, kind, due_at)
     VALUES ($1, 'opened', now())
     ON CONFLICT (competition_id, kind, audience) DO NOTHING`,
    [competitionId],
  );
  if (competition.locks_at) {
    const reminderHours =
      (await one<{ value: number }>(
        "SELECT value::text::int AS value FROM settings WHERE key='reminder_hours_before_lock'",
      ))?.value ?? 1;
    const due = new Date(
      new Date(competition.locks_at).getTime() - reminderHours * 3_600_000,
    );
    await query(
      `INSERT INTO notifications (competition_id, kind, due_at)
       VALUES ($1, 'reminder', $2)
       ON CONFLICT (competition_id, kind, audience) DO NOTHING`,
      [competitionId, due],
    );
  }
  await audit(adminUserId, "competition.publish",
    `Competition "${competition.name}" published`, "competition", competitionId);
}

/** Copy a competition, without its participants (spec §16). */
export async function duplicateCompetition(
  competitionId: number,
  newName: string,
  adminUserId: number | null = null,
): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO competitions
       (name, type, description, prize_amount, currency, winner_count,
        requires_membership, channel_chat_id, scoring, tiebreakers,
        jackpot_increment, template_id, created_by, status)
     SELECT $2, type, description, prize_amount, currency, winner_count,
            requires_membership, channel_chat_id, scoring, tiebreakers,
            jackpot_increment, template_id, $3, 'draft'
       FROM competitions WHERE id = $1
     RETURNING id`,
    [competitionId, newName, adminUserId],
  );
  const id = rows[0].id;
  await audit(adminUserId, "competition.duplicate",
    `Competition #${competitionId} duplicated to "${newName}"`,
    "competition", id);
  return id;
}

// ---------------------------------------------------------------- giveaways
export interface DrawResult {
  winnerUserId: number | null;
  poolSize: number;
  seed: string;
}

/**
 * Draw a giveaway winner (spec §17).
 *
 * The pool and the seed are stored with the result, so the draw can be shown to
 * have been made from the entrants who were actually in it at that moment -
 * "trust me" is not a good enough answer when there is money attached.
 */
export async function drawGiveaway(
  competitionId: number,
  adminUserId: number | null = null,
): Promise<DrawResult> {
  const pool = await query<{ user_id: number }>(
    `SELECT pa.user_id FROM participants pa
      WHERE pa.competition_id = $1
      ORDER BY pa.id`,
    [competitionId],
  );
  if (!pool.length) throw new Error("No participants - there is nobody to draw");

  const seed = crypto.randomUUID();
  // Uniform over the pool, from the platform's cryptographic source rather than
  // Math.random.
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % pool.length;
  const winnerUserId = pool[index].user_id;

  await tx(async (client) => {
    await client.query(
      `INSERT INTO draws
         (competition_id, winner_user_id, pool_size, pool_snapshot, seed, drawn_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        competitionId,
        winnerUserId,
        pool.length,
        JSON.stringify(pool.map((p) => p.user_id)),
        seed,
        adminUserId,
      ],
    );
    await client.query(
      `UPDATE participants SET is_winner = TRUE, rank = 1
        WHERE competition_id = $1 AND user_id = $2`,
      [competitionId, winnerUserId],
    );
    await client.query(
      `UPDATE competitions SET status = 'finished', evaluated_at = now() WHERE id = $1`,
      [competitionId],
    );
  });

  await audit(adminUserId, "giveaway.draw",
    `Winner drawn from ${pool.length} participants`, "competition", competitionId);
  return { winnerUserId, poolSize: pool.length, seed };
}

// ---------------------------------------------------------------- prizes
export async function markPrizePaid(
  prizeId: number,
  adminUserId: number | null = null,
): Promise<void> {
  await query(
    `UPDATE prizes SET status = 'paid', paid_at = now() WHERE id = $1`,
    [prizeId],
  );
  await audit(adminUserId, "prize.paid", `Prize #${prizeId} marked as paid`,
    "prize", prizeId);
}
