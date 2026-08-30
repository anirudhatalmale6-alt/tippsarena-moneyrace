/**
 * Create a competition (spec §14, §15).
 *
 * Picking a template pre-fills the form; the operator sets the prize and the
 * times, ticks the matches, and publishes. No code, and it works on a phone.
 */
import { query } from "@/lib/db.ts";
import { utcToZonedInput, whenAdmin } from "@/lib/templates.ts";
import { Notice, Shell, requireAdmin } from "../../shell.tsx";
import { actionCreateCompetition } from "../../actions.ts";

export const dynamic = "force-dynamic";

interface Template {
  id: number;
  name: string;
  type: string;
  defaults: any;
}

export default async function NewCompetitionPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; league?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const templates = await query<Template>(
    "SELECT id, name, type, defaults FROM competition_templates WHERE is_active ORDER BY sort_order",
  );
  const chosen = templates.find((t) => String(t.id) === params.template) ?? null;
  const defaults = chosen?.defaults ?? {};

  const [{ tz }] = await query<{ tz: string }>(
    "SELECT COALESCE(value #>> '{}', 'Europe/Berlin') AS tz FROM settings WHERE key = 'timezone'",
  );
  const [{ season }] = await query<{ season: number }>(
    "SELECT COALESCE((value)::text::int, 2026) AS season FROM settings WHERE key = 'football_default_season'",
  );

  // Matches already in the database that have not kicked off, so a competition
  // can be built without importing again if the import already happened.
  const league = params.league ? Number(params.league) : (defaults.league_id ?? null);
  const available = await query<{
    id: number; home_team: string; away_team: string; kickoff_at: Date;
    league_name: string | null; league_id: number | null;
  }>(
    `SELECT id, home_team, away_team, kickoff_at, league_name, league_id
       FROM fixtures
      WHERE kickoff_at > now()
        AND ($1::int IS NULL OR league_id = $1::int)
      ORDER BY kickoff_at
      LIMIT 60`,
    [league],
  );

  const leagues = await query<{ league_id: number; league_name: string; n: number }>(
    `SELECT league_id, league_name, COUNT(*)::int AS n
       FROM fixtures WHERE kickoff_at > now() AND league_id IS NOT NULL
      GROUP BY league_id, league_name ORDER BY league_name`,
  );

  return (
    <Shell title="New competition" active="/competitions">
      <div className="panel">
        <strong>1. Choose a template</strong>
        <div className="hint">
          Loads the default settings. Everything can still be changed afterwards.
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          {templates.map((t) => (
            <a
              key={t.id}
              className={`button small ${chosen?.id === t.id ? "" : "secondary"}`}
              href={`/competitions/new?template=${t.id}`}
            >
              {t.name}
            </a>
          ))}
          <a
            className={`button small ${chosen ? "secondary" : ""}`}
            href="/competitions/new"
          >
            No template
          </a>
        </div>
      </div>

      {available.length === 0 ? (
        <Notice kind="warn">
          There are no upcoming matches in the database.{" "}
          <a href="/matches">Import matches first</a>, then come back here.
        </Notice>
      ) : null}

      <form action={actionCreateCompetition}>
        <input type="hidden" name="template_id" value={chosen?.id ?? ""} />

        {/* The type decides the whole interface a player sees, so it is chosen
            here and it is explicit. A template sets it; without one it has to
            be picked deliberately rather than defaulted into a MoneyRace. */}
        <div className="panel">
          <strong>2. What kind of competition?</strong>
          <div className="row" style={{ marginTop: 10 }}>
            <div>
              <label htmlFor="type">Type</label>
              <select id="type" name="type" defaultValue={chosen?.type ?? "moneyrace"}>
                <option value="moneyrace">🏁 MoneyRace — several matches, home / draw / away</option>
                <option value="exact_score">🎯 Exact score — one match, the precise result</option>
                <option value="giveaway">🎁 Giveaway — no football, one button, a random draw</option>
              </select>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            A giveaway needs no matches and no lock time for predictions — only a
            closing time. An exact-score competition is normally a single match.
          </div>
        </div>

        <div className="panel">
          <strong>3. Basics</strong>
          <div className="row">
            <div>
              <label htmlFor="name">Name</label>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={chosen ? `${chosen.name.replace(/^\S+\s/, "")} #1` : ""}
                placeholder="Champions League MoneyRace #4"
              />
            </div>
            <div>
              <label htmlFor="prize_amount">Prize money</label>
              <input
                id="prize_amount"
                name="prize_amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={defaults.prize_amount ?? 0}
              />
            </div>
            <div>
              <label htmlFor="currency">Currency</label>
              <select id="currency" name="currency" defaultValue="EUR">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="MKD">MKD</option>
              </select>
            </div>
            <div>
              <label htmlFor="winner_count">Number of winners</label>
              <input id="winner_count" name="winner_count" type="number" min="1" defaultValue={1} />
            </div>
          </div>

          <label htmlFor="description">Description (optional)</label>
          <input id="description" name="description" type="text" />
        </div>

        <div className="panel">
          <strong>4. Times</strong>
          <div className="hint">
            All times in {tz}. The lock has to be before the first kick-off.
          </div>
          <div className="row">
            <div>
              <label htmlFor="opens_at">Starts</label>
              <input
                id="opens_at"
                name="opens_at"
                type="datetime-local"
                defaultValue={utcToZonedInput(new Date(), tz)}
              />
            </div>
            <div>
              <label htmlFor="locks_at">Lock</label>
              <input id="locks_at" name="locks_at" type="datetime-local" required />
            </div>
            <div>
              <label htmlFor="ends_at">Ends (optional)</label>
              <input id="ends_at" name="ends_at" type="datetime-local" />
            </div>
          </div>
        </div>

        <div className="panel">
          <strong>5. Points and entry</strong>
          <div className="row">
            <div>
              <label htmlFor="points_correct">Points for the right outcome</label>
              <input
                id="points_correct"
                name="points_correct"
                type="number"
                step="1"
                defaultValue={defaults.scoring?.correct_outcome ?? 1}
              />
            </div>
            <div>
              <label htmlFor="points_exact">Points for the exact score</label>
              <input
                id="points_exact"
                name="points_exact"
                type="number"
                step="1"
                defaultValue={defaults.scoring?.exact_score ?? 0}
              />
              <div className="hint">
                In a MoneyRace this is a bonus <em>on top of</em> the outcome
                points. In an Exact Score round it <em>replaces</em> them — 3
                here means 3, not 1 + 3. And while the Exact Score rule in
                Settings is on &ldquo;3 / 0&rdquo;, the outcome box is ignored
                for Exact Score rounds: a wrong scoreline scores nothing.
              </div>
            </div>
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
            <input
              type="checkbox"
              name="requires_membership"
              defaultChecked={defaults.requires_membership ?? true}
              style={{ width: 18, height: 18, accentColor: "var(--green)" }}
            />
            Channel membership required
          </label>
        </div>

        <div className="panel">
          <strong>6. Choose the matches</strong>
          <div className="hint" style={{ marginBottom: 8 }}>
            {defaults.match_count
              ? `Template suggests ${defaults.match_count} matches. `
              : ""}
            The order in the bot is kick-off time.
          </div>

          <div className="actions" style={{ marginBottom: 10 }}>
            {leagues.map((l) => (
              <a
                key={l.league_id}
                className={`button small ${league === l.league_id ? "" : "secondary"}`}
                href={`/competitions/new?${params.template ? `template=${params.template}&` : ""}league=${l.league_id}`}
              >
                {l.league_name} ({l.n})
              </a>
            ))}
            {league ? (
              <a
                className="button small secondary"
                href={`/competitions/new${params.template ? `?template=${params.template}` : ""}`}
              >
                All leagues
              </a>
            ) : null}
          </div>

          {available.map((f, i) => (
            <label className="checkline" key={f.id}>
              <input
                type="checkbox"
                name="fixture"
                value={f.id}
                defaultChecked={
                  defaults.match_count ? i < Number(defaults.match_count) : false
                }
              />
              <span>
                <strong>{f.home_team}</strong> — <strong>{f.away_team}</strong>
                <div className="hint">
                  {whenAdmin(f.kickoff_at, tz)} · {f.league_name ?? "?"}
                </div>
              </span>
            </label>
          ))}
        </div>

        <div className="actions">
          <button type="submit">SAVE AS DRAFT</button>
          <a className="button secondary" href="/competitions">
            Cancel
          </a>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          <strong>A draft is not in the bot yet.</strong> The next page has a PUBLISH
          button — that is the step that makes it visible to players and sends the
          announcement.
        </div>
      </form>
    </Shell>
  );
}
