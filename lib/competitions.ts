/**
 * Competition lifecycle: entering, predicting, locking, evaluating.
 *
 * The single most important rule in the whole spec is §11 - a prediction cannot
 * change after the lock. That rule is enforced HERE, in one function
 * (`savePrediction`), and in the database, and not anywhere else. Every screen
 * that wants to store a pick goes through it.
 */
import { one, query, tx } from "./db.ts";
import { log } from "./log.ts";
import {
  DEFAULT_TIEBREAKERS,
  normaliseScoring,
  normaliseTiebreakers,
  rank,
  scorePrediction,
  type Standing,
  type TiebreakKey,
} from "./scoring.ts";

export type CompetitionStatus =
  | "draft"
  | "open"
  | "locked"
  | "evaluating"
  | "finished"
  | "cancelled";

export interface Competition {
  id: number;
  name: string;
  type: string;
  status: CompetitionStatus;
  description: string | null;
  prize_amount: number;
  currency: string;
  winner_count: number;
  requires_membership: boolean;
  channel_chat_id: string | null;
  opens_at: Date | null;
  locks_at: Date | null;
  ends_at: Date | null;
  scoring: unknown;
  tiebreakers: unknown;
  jackpot_amount: number | null;
  jackpot_increment: number | null;
  evaluation_note: string | null;
}

export async function getCompetition(id: number): Promise<Competition | null> {
  return one<Competition>("SELECT * FROM competitions WHERE id = $1", [id]);
}

/**
 * Is this competition still accepting predictions RIGHT NOW?
 *
 * Deliberately answered from the clock and not only from the stored status: the
 * worker flips the status a few seconds after the lock time, and nobody may
 * sneak a prediction into that gap.
 */
export function isOpenForPredictions(
  competition: Competition,
  now: Date = new Date(),
): boolean {
  if (competition.status !== "open") return false;
  if (competition.opens_at && now < competition.opens_at) return false;
  if (competition.locks_at && now >= competition.locks_at) return false;
  return true;
}

/** Everything a visitor could reasonably be shown right now. */
export async function listOpenCompetitions(
  now: Date = new Date(),
): Promise<Competition[]> {
  return query<Competition>(
    `SELECT * FROM competitions
      WHERE status = 'open'
        AND (opens_at IS NULL OR opens_at <= $1)
        AND (locks_at IS NULL OR locks_at > $1)
      ORDER BY locks_at NULLS LAST, id`,
    [now],
  );
}

export interface CompetitionFixture {
  competition_fixture_id: number;
  fixture_id: number;
  position: number;
  home_team: string;
  away_team: string;
  kickoff_at: Date;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  outcome: "H" | "D" | "A" | null;
}

export async function competitionFixtures(
  competitionId: number,
): Promise<CompetitionFixture[]> {
  return query<CompetitionFixture>(
    `SELECT cf.id AS competition_fixture_id, f.id AS fixture_id, cf.position,
            f.home_team, f.away_team, f.kickoff_at, f.status,
            f.home_goals, f.away_goals, f.outcome
       FROM competition_fixtures cf
       JOIN fixtures f ON f.id = cf.fixture_id
      WHERE cf.competition_id = $1
      ORDER BY cf.position`,
    [competitionId],
  );
}

/** Join a competition, or return the existing participation. Never duplicates. */
export async function joinCompetition(
  competitionId: number,
  userId: number,
): Promise<{ id: number; completed: boolean; submitted_at: Date | null }> {
  const rows = await query<{ id: number; completed: boolean; submitted_at: Date | null }>(
    `INSERT INTO participants (competition_id, user_id)
          VALUES ($1, $2)
     ON CONFLICT (competition_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING id, completed, submitted_at`,
    [competitionId, userId],
  );
  return rows[0];
}

export class PredictionsLockedError extends Error {
  constructor() {
    super("predictions are locked");
    this.name = "PredictionsLockedError";
  }
}

/**
 * Store one prediction.
 *
 * THE lock. Nothing else in the codebase writes to `predictions`, so there is
 * exactly one place that can be got wrong, and the check re-reads the
 * competition inside the transaction rather than trusting whatever the caller
 * looked at a few seconds ago.
 */
export async function savePrediction(
  competitionId: number,
  participantId: number,
  competitionFixtureId: number,
  value: { pick?: "H" | "D" | "A" | null; homeGoals?: number | null; awayGoals?: number | null },
  now: Date = new Date(),
): Promise<void> {
  await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, opens_at, locks_at FROM competitions
        WHERE id = $1 FOR UPDATE`,
      [competitionId],
    );
    const competition = rows[0];
    if (!competition) throw new Error(`competition ${competitionId} not found`);
    if (!isOpenForPredictions(competition as Competition, now)) {
      throw new PredictionsLockedError();
    }

    // The fixture has to belong to THIS competition. Without this check a
    // crafted callback could write a prediction into somebody else's race.
    const belongs = await client.query(
      `SELECT 1 FROM competition_fixtures WHERE id = $1 AND competition_id = $2`,
      [competitionFixtureId, competitionId],
    );
    if (!belongs.rowCount) {
      throw new Error(
        `fixture ${competitionFixtureId} is not part of competition ${competitionId}`,
      );
    }

    // ...and so does the participant, for the same reason.
    const participant = await client.query(
      `SELECT 1 FROM participants WHERE id = $1 AND competition_id = $2`,
      [participantId, competitionId],
    );
    if (!participant.rowCount) {
      throw new Error(
        `participant ${participantId} is not in competition ${competitionId}`,
      );
    }

    await client.query(
      `INSERT INTO predictions
         (participant_id, competition_fixture_id, pick, home_goals, away_goals)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (participant_id, competition_fixture_id) DO UPDATE
         SET pick = EXCLUDED.pick,
             home_goals = EXCLUDED.home_goals,
             away_goals = EXCLUDED.away_goals,
             updated_at = now()`,
      [
        participantId,
        competitionFixtureId,
        value.pick ?? null,
        value.homeGoals ?? null,
        value.awayGoals ?? null,
      ],
    );

    // Mark the set complete the moment the last one lands. submitted_at is only
    // ever written once - it is a tiebreak, so re-answering a question must not
    // move somebody down the order.
    await client.query(
      `UPDATE participants p
          SET completed = TRUE,
              submitted_at = COALESCE(p.submitted_at, now())
        WHERE p.id = $1
          AND (SELECT COUNT(*) FROM predictions x WHERE x.participant_id = p.id)
              >= (SELECT COUNT(*) FROM competition_fixtures c
                   WHERE c.competition_id = $2)`,
      [participantId, competitionId],
    );
  });
}

export async function predictionsOf(
  participantId: number,
): Promise<Map<number, { pick: string | null; homeGoals: number | null; awayGoals: number | null }>> {
  const rows = await query<{
    competition_fixture_id: number;
    pick: string | null;
    home_goals: number | null;
    away_goals: number | null;
  }>(
    `SELECT competition_fixture_id, pick, home_goals, away_goals
       FROM predictions WHERE participant_id = $1`,
    [participantId],
  );
  return new Map(
    rows.map((r) => [
      r.competition_fixture_id,
      { pick: r.pick, homeGoals: r.home_goals, awayGoals: r.away_goals },
    ]),
  );
}

export interface EvaluationOutcome {
  scored: number;
  missingResults: number;
  complete: boolean;
}

/**
 * Score every prediction, rank everyone, and say honestly whether it is final.
 *
 * Safe to run as often as you like: it recomputes from the fixtures every time,
 * so a corrected result simply produces a corrected leaderboard.
 *
 * `complete` is false when any match still has no result. Spec §37: a
 * competition with a missing result is marked "Auswertung ausstehend", never
 * declared won.
 */
export async function evaluateCompetition(
  competitionId: number,
): Promise<EvaluationOutcome> {
  const competition = await getCompetition(competitionId);
  if (!competition) throw new Error(`competition ${competitionId} not found`);

  const scoring = normaliseScoring(competition.scoring);
  const tiebreakers: TiebreakKey[] = normaliseTiebreakers(
    competition.tiebreakers ?? DEFAULT_TIEBREAKERS,
  );

  const fixtures = await competitionFixtures(competitionId);
  const missingResults = fixtures.filter((f) => f.outcome === null).length;

  const rows = await query<{
    prediction_id: number;
    participant_id: number;
    competition_fixture_id: number;
    pick: "H" | "D" | "A" | null;
    home_goals: number | null;
    away_goals: number | null;
    submitted_at: Date | null;
  }>(
    `SELECT pr.id AS prediction_id, pr.participant_id, pr.competition_fixture_id,
            pr.pick, pr.home_goals, pr.away_goals, pa.submitted_at
       FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id
      WHERE pa.competition_id = $1`,
    [competitionId],
  );

  const byFixture = new Map(fixtures.map((f) => [f.competition_fixture_id, f]));
  const totals = new Map<number, Standing>();

  // Everyone who joined appears in the standings, including someone who entered
  // and predicted nothing - otherwise the participant count and the leaderboard
  // length disagree and neither can be trusted.
  const participants = await query<{ id: number; submitted_at: Date | null }>(
    `SELECT id, submitted_at FROM participants WHERE competition_id = $1`,
    [competitionId],
  );
  for (const p of participants) {
    totals.set(p.id, {
      participantId: p.id,
      points: 0,
      exactHits: 0,
      correctCount: 0,
      submittedAt: p.submitted_at ? new Date(p.submitted_at).getTime() : null,
    });
  }

  const updates: Array<[number, number, boolean | null, boolean | null]> = [];

  for (const row of rows) {
    const fixture = byFixture.get(row.competition_fixture_id);
    if (!fixture) continue;

    const scored = scorePrediction(
      { pick: row.pick, homeGoals: row.home_goals, awayGoals: row.away_goals },
      {
        outcome: fixture.outcome,
        homeGoals: fixture.home_goals,
        awayGoals: fixture.away_goals,
      },
      scoring,
    );

    // A match without a result stores nulls, not false: "not known yet" and
    // "got it wrong" must not look the same in the database.
    updates.push([
      row.prediction_id,
      scored.points,
      fixture.outcome === null ? null : scored.isCorrect,
      fixture.outcome === null ? null : scored.isExact,
    ]);

    const total = totals.get(row.participant_id);
    if (!total) continue;
    total.points += scored.points;
    if (scored.isCorrect) total.correctCount += 1;
    if (scored.isExact) total.exactHits += 1;
  }

  const ranked = rank([...totals.values()], tiebreakers);

  await tx(async (client) => {
    for (const [id, points, isCorrect, isExact] of updates) {
      await client.query(
        `UPDATE predictions SET points = $2, is_correct = $3, is_exact = $4
          WHERE id = $1`,
        [id, points, isCorrect, isExact],
      );
    }
    for (const standing of ranked) {
      await client.query(
        `UPDATE participants
            SET points = $2, exact_hits = $3, correct_count = $4, rank = $5,
                is_winner = $6
          WHERE id = $1`,
        [
          standing.participantId,
          standing.points,
          standing.exactHits,
          standing.correctCount,
          standing.rank ?? null,
          missingResults === 0 &&
            standing.rank !== undefined &&
            standing.rank <= competition.winner_count,
        ],
      );
    }
    await client.query(
      `UPDATE competitions
          SET evaluated_at = now(),
              evaluation_note = $2,
              updated_at = now()
        WHERE id = $1`,
      [
        competitionId,
        missingResults === 0
          ? null
          : `${missingResults} Spiel(e) ohne Ergebnis - Auswertung ausstehend`,
      ],
    );
  });

  log.info(
    `evaluated competition ${competitionId}: ${updates.length} predictions, ` +
      `${ranked.length} participants, ${missingResults} missing results`,
  );

  return {
    scored: updates.length,
    missingResults,
    complete: missingResults === 0,
  };
}

export interface LeaderboardRow {
  rank: number | null;
  user_id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  points: number;
  correct_count: number;
  exact_hits: number;
}

export async function leaderboard(
  competitionId: number,
  limit = 20,
): Promise<LeaderboardRow[]> {
  return query<LeaderboardRow>(
    `SELECT pa.rank, u.id AS user_id, u.telegram_id, u.username, u.first_name,
            pa.points, pa.correct_count, pa.exact_hits
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1
      ORDER BY pa.rank NULLS LAST, pa.points DESC, pa.id
      LIMIT $2`,
    [competitionId, limit],
  );
}
