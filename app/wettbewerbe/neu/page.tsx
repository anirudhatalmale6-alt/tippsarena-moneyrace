/**
 * Create a competition (spec §14, §15).
 *
 * Picking a template pre-fills the form; the operator sets the prize and the
 * times, ticks the matches, and publishes. No code, and it works on a phone.
 */
import { query } from "@/lib/db.ts";
import { utcToZonedInput, when } from "@/lib/templates.ts";
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
  searchParams: Promise<{ vorlage?: string; league?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const templates = await query<Template>(
    "SELECT id, name, type, defaults FROM competition_templates WHERE is_active ORDER BY sort_order",
  );
  const chosen = templates.find((t) => String(t.id) === params.vorlage) ?? null;
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
    <Shell title="Neue Competition" active="/wettbewerbe">
      <div className="panel">
        <strong>1. Vorlage wählen</strong>
        <div className="hint">
          Lädt die Standard-Einstellungen. Alles lässt sich danach noch ändern.
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          {templates.map((t) => (
            <a
              key={t.id}
              className={`button small ${chosen?.id === t.id ? "" : "secondary"}`}
              href={`/wettbewerbe/neu?vorlage=${t.id}`}
            >
              {t.name}
            </a>
          ))}
          <a
            className={`button small ${chosen ? "secondary" : ""}`}
            href="/wettbewerbe/neu"
          >
            Ohne Vorlage
          </a>
        </div>
      </div>

      {available.length === 0 ? (
        <Notice kind="warn">
          Es sind keine kommenden Spiele in der Datenbank.{" "}
          <a href="/spiele">Zuerst Spiele importieren</a>, dann hierher zurück.
        </Notice>
      ) : null}

      <form action={actionCreateCompetition}>
        <input type="hidden" name="template_id" value={chosen?.id ?? ""} />
        <input type="hidden" name="type" value={chosen?.type ?? "moneyrace"} />

        <div className="panel">
          <strong>2. Eckdaten</strong>
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
              <label htmlFor="prize_amount">Preisgeld</label>
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
              <label htmlFor="currency">Währung</label>
              <select id="currency" name="currency" defaultValue="EUR">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="MKD">MKD</option>
              </select>
            </div>
            <div>
              <label htmlFor="winner_count">Anzahl Gewinner</label>
              <input id="winner_count" name="winner_count" type="number" min="1" defaultValue={1} />
            </div>
          </div>

          <label htmlFor="description">Beschreibung (optional)</label>
          <input id="description" name="description" type="text" />
        </div>

        <div className="panel">
          <strong>3. Zeiten</strong>
          <div className="hint">
            Alle Zeiten in {tz}. Der Tippschluss muss vor dem ersten Anpfiff liegen.
          </div>
          <div className="row">
            <div>
              <label htmlFor="opens_at">Start</label>
              <input
                id="opens_at"
                name="opens_at"
                type="datetime-local"
                defaultValue={utcToZonedInput(new Date(), tz)}
              />
            </div>
            <div>
              <label htmlFor="locks_at">Tippschluss</label>
              <input id="locks_at" name="locks_at" type="datetime-local" required />
            </div>
            <div>
              <label htmlFor="ends_at">Ende (optional)</label>
              <input id="ends_at" name="ends_at" type="datetime-local" />
            </div>
          </div>
        </div>

        <div className="panel">
          <strong>4. Punkte und Teilnahme</strong>
          <div className="row">
            <div>
              <label htmlFor="points_correct">Punkte für richtigen Ausgang</label>
              <input
                id="points_correct"
                name="points_correct"
                type="number"
                step="1"
                defaultValue={defaults.scoring?.correct_outcome ?? 1}
              />
            </div>
            <div>
              <label htmlFor="points_exact">Bonus für exaktes Ergebnis</label>
              <input
                id="points_exact"
                name="points_exact"
                type="number"
                step="1"
                defaultValue={defaults.scoring?.exact_score ?? 0}
              />
              <div className="hint">Wird zusätzlich zum Ausgang vergeben.</div>
            </div>
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
            <input
              type="checkbox"
              name="requires_membership"
              defaultChecked={defaults.requires_membership ?? true}
              style={{ width: 18, height: 18, accentColor: "var(--green)" }}
            />
            Kanal-Mitgliedschaft erforderlich
          </label>
        </div>

        <div className="panel">
          <strong>5. Spiele auswählen</strong>
          <div className="hint" style={{ marginBottom: 8 }}>
            {defaults.match_count
              ? `Vorlage schlägt ${defaults.match_count} Spiele vor. `
              : ""}
            Die Reihenfolge im Bot ist die Anstoßzeit.
          </div>

          <div className="actions" style={{ marginBottom: 10 }}>
            {leagues.map((l) => (
              <a
                key={l.league_id}
                className={`button small ${league === l.league_id ? "" : "secondary"}`}
                href={`/wettbewerbe/neu?${params.vorlage ? `vorlage=${params.vorlage}&` : ""}league=${l.league_id}`}
              >
                {l.league_name} ({l.n})
              </a>
            ))}
            {league ? (
              <a
                className="button small secondary"
                href={`/wettbewerbe/neu${params.vorlage ? `?vorlage=${params.vorlage}` : ""}`}
              >
                Alle Ligen
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
                  {when(f.kickoff_at, tz)} · {f.league_name ?? "?"}
                </div>
              </span>
            </label>
          ))}
        </div>

        <div className="actions">
          <button type="submit">ALS ENTWURF SPEICHERN</button>
          <a className="button secondary" href="/wettbewerbe">
            Abbrechen
          </a>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Veröffentlicht wird auf der nächsten Seite — dann geht auch die
          Kanal-Ankündigung raus.
        </div>
      </form>
    </Shell>
  );
}
