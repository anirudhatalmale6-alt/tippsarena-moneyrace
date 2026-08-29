/**
 * Storing football data (spec §12, §13, §37).
 *
 * The one rule that matters: an import NEVER destroys what is already there.
 * A provider outage, a rate limit, a half answer - none of them may turn into
 * "the match finished 0-0" or into a fixture disappearing from a live
 * competition. Results are only written when the provider says the match is
 * over, and a manually corrected result is never overwritten by the API.
 */
import { query, one } from "./db.ts";
import { log } from "./log.ts";
import {
  fixturesByIds,
  isAbandoned,
  isFinished,
  outcomeOf,
  type FixtureRow,
} from "./football.ts";

export interface StoredFixture {
  id: number;
  external_id: number;
  home_team: string;
  away_team: string;
  kickoff_at: Date;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  outcome: "H" | "D" | "A" | null;
  manual: boolean;
}

/**
 * Insert or refresh one fixture and return its local id.
 *
 * Scores are written only for a finished match. Before that the goals columns
 * stay null on purpose: a half-time 1-0 stored as a result would score every
 * prediction wrongly if anything read it early.
 */
export async function upsertFixture(row: FixtureRow): Promise<number> {
  const finished = isFinished(row.status);
  const homeGoals = finished ? row.homeGoals : null;
  const awayGoals = finished ? row.awayGoals : null;
  const outcome = finished ? outcomeOf(row.homeGoals, row.awayGoals) : null;

  const rows = await query<{ id: number }>(
    `INSERT INTO fixtures
       (provider, external_id, league_id, league_name, season, round,
        home_team, away_team, home_team_id, away_team_id, kickoff_at, status,
        home_goals, away_goals, outcome, finished_at, raw, updated_at)
     VALUES ('api-football',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             CASE WHEN $15 THEN now() ELSE NULL END, $16, now())
     ON CONFLICT (provider, external_id) DO UPDATE SET
        league_name = EXCLUDED.league_name,
        round       = EXCLUDED.round,
        home_team   = EXCLUDED.home_team,
        away_team   = EXCLUDED.away_team,
        kickoff_at  = EXCLUDED.kickoff_at,
        status      = EXCLUDED.status,
        -- A result entered by hand in the dashboard outranks the API. He only
        -- corrects one when the API is wrong, and the next poll must not undo it.
        home_goals  = CASE WHEN fixtures.manual THEN fixtures.home_goals
                           ELSE COALESCE(EXCLUDED.home_goals, fixtures.home_goals) END,
        away_goals  = CASE WHEN fixtures.manual THEN fixtures.away_goals
                           ELSE COALESCE(EXCLUDED.away_goals, fixtures.away_goals) END,
        outcome     = CASE WHEN fixtures.manual THEN fixtures.outcome
                           ELSE COALESCE(EXCLUDED.outcome, fixtures.outcome) END,
        finished_at = COALESCE(fixtures.finished_at, EXCLUDED.finished_at),
        raw         = EXCLUDED.raw,
        updated_at  = now()
     RETURNING id`,
    [
      row.externalId, row.leagueId, row.leagueName, row.season, row.round,
      row.homeTeam, row.awayTeam, row.homeTeamId, row.awayTeamId,
      row.kickoffAt, row.status, homeGoals, awayGoals, outcome, finished,
      JSON.stringify(row.raw),
    ],
  );
  return rows[0].id;
}

export async function upsertFixtures(rows: FixtureRow[]): Promise<number[]> {
  const ids: number[] = [];
  for (const row of rows) ids.push(await upsertFixture(row));
  return ids;
}

/** Set a result by hand (spec §12: the admin must be able to correct one). */
export async function setManualResult(
  fixtureId: number,
  homeGoals: number,
  awayGoals: number,
): Promise<void> {
  await query(
    `UPDATE fixtures
        SET home_goals = $2, away_goals = $3, outcome = $4,
            status = 'FT', manual = TRUE,
            finished_at = COALESCE(finished_at, now()), updated_at = now()
      WHERE id = $1`,
    [fixtureId, homeGoals, awayGoals, outcomeOf(homeGoals, awayGoals)],
  );
  log.info(`manual result set on fixture ${fixtureId}: ${homeGoals}-${awayGoals}`);
}

/** Hand a result back to the API's control. */
export async function clearManualResult(fixtureId: number): Promise<void> {
  await query(`UPDATE fixtures SET manual = FALSE WHERE id = $1`, [fixtureId]);
}

/**
 * Fixtures that still need watching: kicked off (or about to), no result yet,
 * and used by at least one competition that is not finished.
 *
 * Scoped this way so the poller's request count is driven by what is actually
 * running, not by the size of the fixtures table.
 */
export async function fixturesNeedingResults(): Promise<StoredFixture[]> {
  return query<StoredFixture>(
    `SELECT DISTINCT f.*
       FROM fixtures f
       JOIN competition_fixtures cf ON cf.fixture_id = f.id
       JOIN competitions c ON c.id = cf.competition_id
      WHERE f.outcome IS NULL
        AND f.manual = FALSE
        AND f.kickoff_at < now()
        AND c.status IN ('open','locked','evaluating')
      ORDER BY f.kickoff_at`,
  );
}

export interface RefreshOutcome {
  checked: number;
  finished: number;
  abandoned: number;
}

/**
 * Ask the provider about every fixture we are waiting on, and store what comes
 * back. Returns counts rather than throwing on a partial answer - the caller
 * decides what a partial answer means for a competition.
 */
export async function refreshPendingResults(): Promise<RefreshOutcome> {
  const pending = await fixturesNeedingResults();
  if (!pending.length) return { checked: 0, finished: 0, abandoned: 0 };

  const rows = await fixturesByIds(pending.map((f) => f.external_id));
  let finished = 0;
  let abandoned = 0;

  for (const row of rows) {
    await upsertFixture(row);
    if (isFinished(row.status)) finished += 1;
    if (isAbandoned(row.status)) {
      abandoned += 1;
      // Not an error and not a result. It is flagged so the dashboard can show
      // the operator that this one needs a decision from him.
      log.warn(
        `fixture ${row.externalId} (${row.homeTeam} - ${row.awayTeam}) is ${row.status}`,
      );
    }
  }

  log.info(
    `results: checked ${pending.length}, ${finished} finished, ${abandoned} abandoned`,
  );
  return { checked: pending.length, finished, abandoned };
}

export async function findFixture(id: number): Promise<StoredFixture | null> {
  return one<StoredFixture>("SELECT * FROM fixtures WHERE id = $1", [id]);
}
