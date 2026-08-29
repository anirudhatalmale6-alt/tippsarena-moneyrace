/** Match import (spec §13). */
import { query } from "@/lib/db.ts";
import { when } from "@/lib/templates.ts";
import { Notice, Shell, requireAdmin } from "../shell.tsx";
import { actionImportFixtures } from "../actions.ts";

export const dynamic = "force-dynamic";

/**
 * The leagues he is most likely to want, with API-Football's own ids.
 *
 * Only ids that have been confirmed against the API are in this list. Any other
 * league can still be imported by typing its id in the box below - guessing an
 * id here would import somebody else's football.
 */
const LEAGUES: Array<[number, string]> = [
  [78, "Bundesliga"],
  [79, "2. Bundesliga"],
  [2, "Champions League"],
  [3, "Europa League"],
  [848, "Conference League"],
  [39, "Premier League"],
  [140, "LaLeague"],
  [135, "Serie A"],
  [61, "Ligue 1"],
];

export default async function FixturesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [{ tz }] = await query<{ tz: string }>(
    "SELECT COALESCE(value #>> '{}', 'Europe/Berlin') AS tz FROM settings WHERE key = 'timezone'",
  );
  const [{ season }] = await query<{ season: number }>(
    "SELECT COALESCE((value)::text::int, 2026) AS season FROM settings WHERE key = 'football_default_season'",
  );

  const upcoming = await query<{
    id: number; home_team: string; away_team: string; kickoff_at: Date;
    league_name: string | null; status: string; used: number;
  }>(
    `SELECT f.id, f.home_team, f.away_team, f.kickoff_at, f.league_name, f.status,
            (SELECT COUNT(*)::int FROM competition_fixtures cf WHERE cf.fixture_id = f.id) AS used
       FROM fixtures f
      WHERE f.kickoff_at > now() - interval '2 days'
      ORDER BY f.kickoff_at
      LIMIT 100`,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Shell title="Matches" active="/matches">
      {params.imported ? (
        <Notice>
          {params.imported} matches imported.{" "}
          <a href="/competitions/new">Build a competition from them</a>.
        </Notice>
      ) : null}
      {params.error ? <Notice kind="bad">{params.error}</Notice> : null}

      <form action={actionImportFixtures} className="panel">
        <strong>⚽ IMPORT MATCHES</strong>
        <div className="hint">
          Pulls the matches straight from the football provider. Matches already
          here are updated, never deleted.
        </div>
        <div className="row">
          <div>
            <label htmlFor="league">League</label>
            <select id="league" name="league" defaultValue={params.league ?? "78"}>
              {LEAGUES.map(([lid, label]) => (
                <option key={lid} value={lid}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="league_custom">…or league ID</label>
            <input
              id="league_custom"
              name="league_custom"
              type="number"
              placeholder="e.g. 88"
            />
            <div className="hint">Overrides the choice on the left.</div>
          </div>
          <div>
            <label htmlFor="season">Season</label>
            <input id="season" name="season" type="number" defaultValue={season} />
          </div>
          <div>
            <label htmlFor="from">From</label>
            <input id="from" name="from" type="date" defaultValue={params.from ?? today} required />
          </div>
          <div>
            <label htmlFor="to">To</label>
            <input id="to" name="to" type="date" defaultValue={params.to ?? today} />
          </div>
        </div>
        <button type="submit">IMPORT</button>
      </form>

      <h2>Matches in the database</h2>
      <div className="panel">
        {upcoming.length === 0 ? (
          <p className="muted">No matches imported yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kick-off</th>
                  <th className="wrap">Match</th>
                  <th>League</th>
                  <th>Status</th>
                  <th>Used in</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((f) => (
                  <tr key={f.id}>
                    <td>{when(f.kickoff_at, tz)}</td>
                    <td className="wrap">
                      {f.home_team} — {f.away_team}
                    </td>
                    <td className="muted">{f.league_name ?? "-"}</td>
                    <td>
                      <span className="badge">{f.status}</span>
                    </td>
                    <td>{f.used ? `${f.used} Competition(e)` : <span className="muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
