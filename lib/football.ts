/**
 * API-Football (v3). The only place this project talks to a football provider.
 *
 * Two rules live here, both from spec §37:
 *
 *  - A failed or empty call NEVER writes. An outage must not turn into "every
 *    match finished 0-0" or into a fixture list that quietly loses matches.
 *  - The provider's own fixture id is what we store and match on. Team names
 *    change spelling between seasons; ids do not.
 */
import { config } from "./config.ts";
import { log } from "./log.ts";

export interface FixtureRow {
  externalId: number;
  leagueId: number | null;
  leagueName: string | null;
  season: number | null;
  round: string | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  kickoffAt: Date;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
  raw: unknown;
}

/** Statuses API-Football uses for a match that is over and will not change. */
const FINISHED = new Set(["FT", "AET", "PEN"]);
/** ...and for one that will never produce a result at all. */
const ABANDONED = new Set(["PST", "CANC", "ABD", "AWD", "WO", "SUSP", "INT"]);

export function isFinished(status: string): boolean {
  return FINISHED.has(status);
}
export function isAbandoned(status: string): boolean {
  return ABANDONED.has(status);
}

/** 'H', 'D' or 'A' - or null when the score is not known yet. */
export function outcomeOf(
  homeGoals: number | null | undefined,
  awayGoals: number | null | undefined,
): "H" | "D" | "A" | null {
  if (homeGoals === null || homeGoals === undefined) return null;
  if (awayGoals === null || awayGoals === undefined) return null;
  if (homeGoals > awayGoals) return "H";
  if (homeGoals < awayGoals) return "A";
  return "D";
}

export class FootballApiError extends Error {}

async function call(path: string, params: Record<string, string>): Promise<any> {
  if (!config.footballKey) {
    throw new FootballApiError("FOOTBALL_API_KEY is not set");
  }
  const url = new URL(`https://${config.footballHost}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, {
    headers: { "x-apisports-key": config.footballKey },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new FootballApiError(`${path} returned HTTP ${response.status}`);
  }
  const body = await response.json();

  // The API answers 200 with an `errors` object for a bad key, an exhausted
  // quota or a plan that does not cover the request. Treating that as success
  // is how an outage becomes silent data loss.
  const errors = body?.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0
    : errors && Object.keys(errors).length > 0;
  if (hasErrors) {
    throw new FootballApiError(`${path}: ${JSON.stringify(errors)}`);
  }
  return body;
}

function toFixtureRow(item: any): FixtureRow {
  return {
    externalId: item.fixture.id,
    leagueId: item.league?.id ?? null,
    leagueName: item.league?.name ?? null,
    season: item.league?.season ?? null,
    round: item.league?.round ?? null,
    homeTeam: item.teams?.home?.name ?? "?",
    awayTeam: item.teams?.away?.name ?? "?",
    homeTeamId: item.teams?.home?.id ?? null,
    awayTeamId: item.teams?.away?.id ?? null,
    kickoffAt: new Date(item.fixture.date),
    status: item.fixture?.status?.short ?? "NS",
    homeGoals: item.goals?.home ?? null,
    awayGoals: item.goals?.away ?? null,
    raw: item,
  };
}

/** Matches in one league on one date (YYYY-MM-DD), for the import screen. */
export async function fixturesByLeagueAndDate(
  leagueId: number,
  season: number,
  date: string,
): Promise<FixtureRow[]> {
  const body = await call("fixtures", {
    league: String(leagueId),
    season: String(season),
    date,
  });
  return (body.response ?? []).map(toFixtureRow);
}

/** Matches in a league between two dates - a whole matchday, in one call. */
export async function fixturesByLeagueRange(
  leagueId: number,
  season: number,
  from: string,
  to: string,
): Promise<FixtureRow[]> {
  const body = await call("fixtures", {
    league: String(leagueId),
    season: String(season),
    from,
    to,
  });
  return (body.response ?? []).map(toFixtureRow);
}

/**
 * Current state of specific fixtures. Up to 20 ids per call is the documented
 * limit, so this chunks rather than silently truncating.
 */
export async function fixturesByIds(ids: number[]): Promise<FixtureRow[]> {
  const out: FixtureRow[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const body = await call("fixtures", { ids: chunk.join("-") });
    const rows = (body.response ?? []).map(toFixtureRow);
    // Loud, because a short answer means some match will never be scored and
    // the competition would otherwise sit in "evaluating" with no explanation.
    if (rows.length !== chunk.length) {
      log.warn(
        `asked for ${chunk.length} fixtures, got ${rows.length}: ` +
          `missing ${chunk.filter((id) => !rows.some((r: FixtureRow) => r.externalId === id)).join(", ")}`,
      );
    }
    out.push(...rows);
  }
  return out;
}

/** Leagues, for the import screen's dropdown. */
export async function leagues(country?: string): Promise<any[]> {
  const body = await call("leagues", country ? { country } : {});
  return body.response ?? [];
}

/** Plan, quota and expiry - shown in the dashboard so an expiry is not a surprise. */
export async function status(): Promise<any> {
  const body = await call("status", {});
  return body.response;
}
