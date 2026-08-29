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

/**
 * What is stopping this competition from going live - in his words, not mine.
 *
 * The same list answers two questions that used to be answered separately: what
 * the detail page greys the PUBLISH button out for, and what publishCompetition
 * refuses on. Two lists would drift, and the way that shows up is a button that
 * looks ready and an error after the click - which is exactly the moment an
 * operator concludes the thing is broken.
 */
export interface Readiness {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  /** True once players can actually see it in the bot. */
  live: boolean;
}

export async function publishReadiness(competitionId: number): Promise<Readiness> {
  const competition = await one<{
    name: string; type: string; status: string; locks_at: Date | null;
    opens_at: Date | null; prize_amount: string; matches: number;
  }>(
    `SELECT c.name, c.type, c.status, c.locks_at, c.opens_at, c.prize_amount,
            (SELECT COUNT(*)::int FROM competition_fixtures cf
              WHERE cf.competition_id = c.id) AS matches
       FROM competitions c WHERE c.id = $1`,
    [competitionId],
  );
  if (!competition) {
    return { ready: false, blockers: ["Competition not found"], warnings: [], live: false };
  }

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!competition.locks_at) {
    blockers.push("No lock time. Set one under Basics - it is the moment predictions close.");
  } else if (new Date(competition.locks_at).getTime() <= Date.now()) {
    blockers.push(
      "The lock time is already in the past, so it would close the moment it opened. Move it forward.",
    );
  }

  // A giveaway has no matches by design; anything else without matches would
  // publish an empty competition to the channel.
  if (competition.type !== "giveaway" && competition.matches === 0) {
    blockers.push('No matches. Pick them under "Change matches" further down this page.');
  }

  if (Number(competition.prize_amount) <= 0) {
    warnings.push("The prize money is 0 - the announcement will say so.");
  }
  if (competition.opens_at && new Date(competition.opens_at).getTime() > Date.now()) {
    warnings.push(
      "The start time is in the future, so publishing schedules it - players will " +
        "see it from that moment, not immediately. Clear the start time to open it now.",
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    live: competition.status === "open",
  };
}

/**
 * "Can a player see this in the bot right now?" - answered in one place.
 *
 * The status word alone did not answer it. He created three competitions, all
 * of them said "draft", and none of them appeared in the bot; nothing on the
 * screen connected those two facts. This turns the status into a sentence.
 */
export interface Visibility {
  visible: boolean;
  label: string;
  /** The full sentence, for the detail page. */
  detail: string;
}

export function visibility(competition: {
  status: string;
  published_at: Date | string | null;
  opens_at: Date | string | null;
}): Visibility {
  const opens = competition.opens_at ? new Date(competition.opens_at) : null;

  switch (competition.status) {
    case "open":
      return { visible: true, label: "Live in the bot", detail: "Players can enter now." };
    case "draft":
      if (competition.published_at && opens && opens.getTime() > Date.now()) {
        return {
          visible: false,
          label: "Scheduled",
          detail: "Published, and it opens by itself at the start time.",
        };
      }
      if (competition.published_at) {
        // Published, the start time has arrived, and the worker has not had its
        // tick yet. Saying "not visible, press PUBLISH" here would send him to
        // press a button that has already been pressed.
        return {
          visible: false,
          label: "Opening",
          detail: "Published - it goes live within the next minute.",
        };
      }
      return {
        visible: false,
        label: "Not visible",
        detail: "Still a draft - press PUBLISH to put it in the bot.",
      };
    case "locked":
      return { visible: false, label: "Locked", detail: "Predictions are closed." };
    case "evaluating":
      return { visible: false, label: "Being scored", detail: "Waiting for results." };
    case "finished":
      return { visible: false, label: "Finished", detail: "Over and scored." };
    case "cancelled":
      return { visible: false, label: "Cancelled", detail: "" };
    default:
      return { visible: false, label: competition.status, detail: "" };
  }
}

/** Move a draft to published so the worker will open it (spec §14). */
export async function publishCompetition(
  competitionId: number,
  adminUserId: number | null = null,
): Promise<void> {
  const competition = await one<{
    id: number; name: string; status: string; locks_at: Date | null;
  }>(
    "SELECT id, name, status, locks_at FROM competitions WHERE id = $1",
    [competitionId],
  );
  if (!competition) throw new Error("Competition not found");

  const readiness = await publishReadiness(competitionId);
  if (!readiness.ready) throw new Error(readiness.blockers.join(" "));

  // A start time in the future means scheduled, not live: the CASE reads the
  // OLD opens_at, so a competition he dated for tomorrow stays a draft and
  // openDue() flips it on the day. Anything without a start time opens now,
  // which is what clicking PUBLISH plainly means.
  await query(
    `UPDATE competitions
        SET published_at = COALESCE(published_at, now()),
            opens_at = COALESCE(opens_at, now()),
            status = CASE
                       WHEN status = 'draft' AND COALESCE(opens_at, now()) <= now()
                       THEN 'open' ELSE status
                     END,
            updated_at = now()
      WHERE id = $1`,
    [competitionId],
  );
  // The announcement is queued, not sent here: one place sends to Telegram, and
  // it retries. A failed publish must not leave a competition half-open. It is
  // due when the competition actually opens - announcing a competition nobody
  // can enter yet would send people to a locked door.
  await query(
    `INSERT INTO notifications (competition_id, kind, due_at)
     SELECT id, 'opened', GREATEST(COALESCE(opens_at, now()), now())
       FROM competitions WHERE id = $1
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
