/**
 * Scoring, ranking and tie-breaking.
 *
 * The pure functions here take plain data and return plain data - no database,
 * no clock, no network - because this is the part that decides who gets the
 * money, and it has to be testable exactly.
 *
 * Spec §9: the points are configuration, not code. Spec §10: ties are broken by
 * an explicit, ordered list of rules and never left to chance.
 */

export interface ScoringConfig {
  /** Points for getting home/draw/away right. */
  correct_outcome: number;
  /**
   * Points for the exact score. What this MEANS depends on the mode:
   *   "add"     - a bonus on top of correct_outcome (MoneyRace: 1 + 2 = 3)
   *   "replace" - the whole score instead of it (Exact Score: 3, flat)
   */
  exact_score: number;
}

/**
 * How the two numbers combine.
 *
 * A MoneyRace is a set of 1X2 picks where guessing the scoreline is a bonus, so
 * they add. An exact-score round is scored the way he wrote it: "Exact score:
 * 3 Punkte. Correct result but incorrect exact score: 1 Punkt." Those are
 * TOTALS, not a base and a bonus - adding them would pay 4 for a hit he said is
 * worth 3, and he would have had no way of knowing except by counting points
 * after somebody won money.
 */
export type ScoringMode = "add" | "replace";

export function scoringModeFor(competitionType: string): ScoringMode {
  return competitionType === "exact_score" ? "replace" : "add";
}

/**
 * The points table a round is ACTUALLY scored with.
 *
 * His rule for an exact-score round, in his words: "if no one gets the exact
 * score no one gets points at all - only 3 points for the exact score". So
 * under `exact_only` the consolation point for the right winner with the wrong
 * scoreline is not reduced, it is gone. Three or nothing.
 *
 * Derived rather than stored, and exported, because the number the dashboard
 * prints and the number the evaluator uses have to be the same number - the way
 * to guarantee that is to have one function and two callers, not two copies of
 * the same `if`. A setting that quietly makes a configured value unreachable is
 * how a rule stops firing without anybody noticing, so every screen that shows
 * the outcome points runs them through here first and says where the 0 came
 * from.
 */
export function effectiveScoring(
  competitionType: string,
  scoring: ScoringConfig,
  exactOnly: boolean,
): ScoringConfig {
  if (competitionType === "exact_score" && exactOnly) {
    return { ...scoring, correct_outcome: 0 };
  }
  return scoring;
}

export const DEFAULT_SCORING: ScoringConfig = {
  correct_outcome: 1,
  exact_score: 0,
};

export function normaliseScoring(raw: unknown): ScoringConfig {
  const value = (raw ?? {}) as Partial<ScoringConfig>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    correct_outcome: num(value.correct_outcome, DEFAULT_SCORING.correct_outcome),
    exact_score: num(value.exact_score, DEFAULT_SCORING.exact_score),
  };
}

export interface PredictionInput {
  pick: "H" | "D" | "A" | null;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface ResultInput {
  outcome: "H" | "D" | "A" | null;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface ScoredPrediction {
  points: number;
  isCorrect: boolean;
  isExact: boolean;
}

/**
 * One prediction against one result.
 *
 * A match with no result yet scores nothing and is NOT counted as wrong - the
 * difference matters, because "0 points so far" and "0 points, final" are
 * different states and only one of them may declare a winner.
 */
export function scorePrediction(
  prediction: PredictionInput,
  result: ResultInput,
  scoring: ScoringConfig,
  mode: ScoringMode = "add",
): ScoredPrediction {
  if (result.outcome === null) {
    return { points: 0, isCorrect: false, isExact: false };
  }

  const isCorrect = prediction.pick !== null && prediction.pick === result.outcome;

  const isExact =
    prediction.homeGoals !== null &&
    prediction.awayGoals !== null &&
    result.homeGoals !== null &&
    result.awayGoals !== null &&
    prediction.homeGoals === result.homeGoals &&
    prediction.awayGoals === result.awayGoals;

  let points = 0;
  if (mode === "replace") {
    // The exact score is the whole answer, so it pays instead of, not as well
    // as. An exact hit always implies the right outcome, so the ordering here
    // can never pay less for a better prediction.
    points = isExact && isCorrect
      ? scoring.exact_score
      : isCorrect
      ? scoring.correct_outcome
      : 0;
  } else {
    if (isCorrect) points += scoring.correct_outcome;
    // An exact score implies the right outcome, so the bonus is only ever paid
    // on top of a correct pick - never on its own.
    if (isExact && isCorrect) points += scoring.exact_score;
  }

  return { points, isCorrect, isExact };
}

export interface Standing {
  participantId: number;
  points: number;
  exactHits: number;
  correctCount: number;
  /** ms since epoch; null means "never finished submitting". */
  submittedAt: number | null;
  rank?: number;
}

export type TiebreakKey = "points" | "exact_hits" | "correct_count" | "submitted_at";

export const DEFAULT_TIEBREAKERS: TiebreakKey[] = [
  "points",
  "exact_hits",
  "submitted_at",
];

export function normaliseTiebreakers(raw: unknown): TiebreakKey[] {
  const allowed: TiebreakKey[] = [
    "points",
    "exact_hits",
    "correct_count",
    "submitted_at",
  ];
  if (!Array.isArray(raw)) return [...DEFAULT_TIEBREAKERS];
  const picked = raw.filter((k): k is TiebreakKey =>
    allowed.includes(k as TiebreakKey),
  );
  // "points" must lead, or the ranking is not a ranking. If the operator has
  // configured something odd, points is put back at the front rather than
  // producing a leaderboard where a lower score can win.
  if (picked[0] !== "points") {
    return ["points", ...picked.filter((k) => k !== "points")];
  }
  return picked.length ? picked : [...DEFAULT_TIEBREAKERS];
}

function compare(a: Standing, b: Standing, key: TiebreakKey): number {
  switch (key) {
    case "points":
      return b.points - a.points;
    case "exact_hits":
      return b.exactHits - a.exactHits;
    case "correct_count":
      return b.correctCount - a.correctCount;
    case "submitted_at": {
      // Earliest wins. Someone who never completed sorts last, never first -
      // a null must not be treated as "submitted at the dawn of time".
      const av = a.submittedAt ?? Number.POSITIVE_INFINITY;
      const bv = b.submittedAt ?? Number.POSITIVE_INFINITY;
      return av - bv;
    }
  }
}

/**
 * Sort into finishing order and assign ranks.
 *
 * Two people who are equal on EVERY configured tiebreak share a rank, and the
 * next rank skips accordingly (1, 2, 2, 4). Inventing an order between two
 * genuinely identical entries would be a silent coin toss over prize money.
 */
export function rank(
  standings: Standing[],
  tiebreakers: TiebreakKey[] = DEFAULT_TIEBREAKERS,
): Standing[] {
  const keys = normaliseTiebreakers(tiebreakers);

  const sorted = [...standings].sort((a, b) => {
    for (const key of keys) {
      const d = compare(a, b, key);
      if (d !== 0) return d;
    }
    // Stable, deterministic last resort so the same input always gives the same
    // output - it does not decide anything, it only stops the order wobbling.
    return a.participantId - b.participantId;
  });

  let lastRank = 0;
  sorted.forEach((entry, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    const tied =
      previous !== null && keys.every((key) => compare(previous, entry, key) === 0);
    entry.rank = tied ? lastRank : index + 1;
    lastRank = entry.rank;
  });

  return sorted;
}

/**
 * Who gets paid. Returns every participant sharing a paying rank, which can be
 * more than winnerCount when there is a genuine tie - that is a decision for
 * the operator, and the system's job is to show him the tie, not hide it.
 */
export function winners(ranked: Standing[], winnerCount: number): Standing[] {
  if (winnerCount <= 0) return [];
  // Shared ranks make this do the right thing by itself: with ranks 1, 2, 2, 4
  // and one prize you get one winner; with two prizes you get three people, all
  // genuinely tied for second. The operator sees the tie and decides.
  return ranked.filter((s) => s.rank !== undefined && s.rank <= winnerCount);
}
