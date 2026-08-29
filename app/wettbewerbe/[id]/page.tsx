/**
 * One competition: edit it, choose its matches, publish it, correct a result,
 * draw a giveaway, re-evaluate (spec §14, §16, §17, §27, §12).
 */
import { notFound } from "next/navigation";
import { competitionFixtures, leaderboard } from "@/lib/competitions.ts";
import { one, query } from "@/lib/db.ts";
import { money, utcToZonedInput, when } from "@/lib/templates.ts";
import { Notice, Shell, StatusBadge, requireAdmin } from "../../shell.tsx";
import {
  actionDrawGiveaway,
  actionDuplicate,
  actionEvaluate,
  actionManualResult,
  actionPublish,
  actionSetFixtures,
  actionSetStatus,
  actionUpdateCompetition,
} from "../../actions.ts";

export const dynamic = "force-dynamic";

export default async function CompetitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const { id: rawId } = await params;
  const flags = await searchParams;
  const id = Number(rawId);
  if (!Number.isFinite(id)) notFound();

  const competition = await one<any>("SELECT * FROM competitions WHERE id = $1", [id]);
  if (!competition) notFound();

  const [{ tz }] = await query<{ tz: string }>(
    "SELECT COALESCE(value #>> '{}', 'Europe/Berlin') AS tz FROM settings WHERE key = 'timezone'",
  );

  const fixtures = await competitionFixtures(id);
  const board = await leaderboard(id, 20);
  const [counts] = await query<{ participants: number; completed: number }>(
    `SELECT COUNT(*)::int AS participants,
            COUNT(*) FILTER (WHERE completed)::int AS completed
       FROM participants WHERE competition_id = $1`,
    [id],
  );
  const draw = await one<{ pool_size: number; drawn_at: Date; username: string | null }>(
    `SELECT d.pool_size, d.drawn_at, u.username
       FROM draws d LEFT JOIN users u ON u.id = d.winner_user_id
      WHERE d.competition_id = $1 ORDER BY d.drawn_at DESC LIMIT 1`,
    [id],
  );

  // Only for a competition whose matches can still be changed.
  const editableFixtures = ["draft", "open"].includes(competition.status);
  const chosen = new Set(fixtures.map((f) => f.fixture_id));
  const available = editableFixtures
    ? await query<{
        id: number; home_team: string; away_team: string;
        kickoff_at: Date; league_name: string | null;
      }>(
        `SELECT id, home_team, away_team, kickoff_at, league_name
           FROM fixtures
          WHERE kickoff_at > now() OR id = ANY($1::bigint[])
          ORDER BY kickoff_at LIMIT 60`,
        [[...chosen]],
      )
    : [];

  const scoring = competition.scoring ?? {};

  return (
    <Shell
      title={competition.name}
      active="/wettbewerbe"
      actions={<StatusBadge status={competition.status} />}
    >
      {flags.angelegt ? <Notice>Wettbewerb angelegt.</Notice> : null}
      {flags.gespeichert ? <Notice>Gespeichert.</Notice> : null}
      {flags.veröffentlicht ? (
        <Notice>
          Veröffentlicht. Die Kanal-Ankündigung geht in der nächsten Minute raus.
        </Notice>
      ) : null}
      {flags.gelost ? (
        <Notice>Gewinner aus {flags.gelost} Teilnehmern gelost.</Notice>
      ) : null}
      {flags.ausgewertet !== undefined ? (
        Number(flags.ausgewertet) > 0 ? (
          <Notice kind="warn">
            Ausgewertet, aber {flags.ausgewertet} Spiel(e) haben noch kein
            Ergebnis. Es wird kein Gewinner bestimmt, bevor alle da sind.
          </Notice>
        ) : (
          <Notice>Ausgewertet. Alle Ergebnisse sind da.</Notice>
        )
      ) : null}
      {flags.fehler ? <Notice kind="bad">{flags.fehler}</Notice> : null}
      {competition.evaluation_note ? (
        <Notice kind="warn">⚠️ {competition.evaluation_note}</Notice>
      ) : null}

      <div className="cards">
        <div className="card">
          <div className="label">Preisgeld</div>
          <div className="value">{money(competition.prize_amount, competition.currency)}</div>
        </div>
        <div className="card">
          <div className="label">Teilnehmer</div>
          <div className="value">{counts?.participants ?? 0}</div>
          <div className="hint">{counts?.completed ?? 0} vollständig</div>
        </div>
        <div className="card">
          <div className="label">Spiele</div>
          <div className="value">{fixtures.length}</div>
        </div>
        <div className="card">
          <div className="label">Tippschluss</div>
          <div className="value" style={{ fontSize: 17 }}>
            {when(competition.locks_at, tz)}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="actions">
          {competition.status === "draft" || !competition.published_at ? (
            <form action={actionPublish}>
              <input type="hidden" name="id" value={id} />
              <button type="submit">VERÖFFENTLICHEN</button>
            </form>
          ) : null}

          <form action={actionDuplicate}>
            <input type="hidden" name="id" value={id} />
            <input
              type="hidden"
              name="name"
              value={nextName(competition.name)}
            />
            <button className="secondary" type="submit">DUPLIZIEREN</button>
          </form>

          {competition.type !== "giveaway" ? (
            <form action={actionEvaluate}>
              <input type="hidden" name="id" value={id} />
              <button className="secondary" type="submit">NEU AUSWERTEN</button>
            </form>
          ) : null}

          {competition.type === "giveaway" && !draw ? (
            <form action={actionDrawGiveaway}>
              <input type="hidden" name="id" value={id} />
              <button type="submit">🏆 GEWINNER AUSLOSEN</button>
            </form>
          ) : null}

          {competition.status === "open" ? (
            <form action={actionSetStatus}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value="locked" />
              <button className="secondary" type="submit">JETZT SPERREN</button>
            </form>
          ) : null}

          <a className="button secondary" href={`/teilnehmer?wettbewerb=${id}`}>
            TEILNEHMER
          </a>
          <a className="button secondary" href={`/leaderboards?wettbewerb=${id}`}>
            LEADERBOARD
          </a>
        </div>
      </div>

      {draw ? (
        <Notice>
          🎁 Gelost am {when(draw.drawn_at, tz)} aus {draw.pool_size} Teilnehmern.
          Gewinner: {draw.username ? `@${draw.username}` : "(kein Benutzername)"}
        </Notice>
      ) : null}

      {/* ------------------------------------------------------- edit */}
      <h2>Eckdaten</h2>
      <form action={actionUpdateCompetition} className="panel">
        <input type="hidden" name="id" value={id} />
        <div className="row">
          <div>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" defaultValue={competition.name} required />
          </div>
          <div>
            <label htmlFor="prize_amount">Preisgeld</label>
            <input
              id="prize_amount"
              name="prize_amount"
              type="number"
              step="0.01"
              defaultValue={competition.prize_amount}
            />
          </div>
          <div>
            <label htmlFor="currency">Währung</label>
            <input id="currency" name="currency" type="text" defaultValue={competition.currency} />
          </div>
          <div>
            <label htmlFor="winner_count">Anzahl Gewinner</label>
            <input
              id="winner_count"
              name="winner_count"
              type="number"
              min="1"
              defaultValue={competition.winner_count}
            />
          </div>
          <div>
            <label htmlFor="opens_at">Start</label>
            <input
              id="opens_at"
              name="opens_at"
              type="datetime-local"
              defaultValue={utcToZonedInput(competition.opens_at, tz)}
            />
          </div>
          <div>
            <label htmlFor="locks_at">Tippschluss</label>
            <input
              id="locks_at"
              name="locks_at"
              type="datetime-local"
              defaultValue={utcToZonedInput(competition.locks_at, tz)}
            />
          </div>
          <div>
            <label htmlFor="ends_at">Ende</label>
            <input
              id="ends_at"
              name="ends_at"
              type="datetime-local"
              defaultValue={utcToZonedInput(competition.ends_at, tz)}
            />
          </div>
          <div>
            <label htmlFor="points_correct">Punkte richtiger Ausgang</label>
            <input
              id="points_correct"
              name="points_correct"
              type="number"
              defaultValue={scoring.correct_outcome ?? 1}
            />
          </div>
          <div>
            <label htmlFor="points_exact">Bonus exaktes Ergebnis</label>
            <input
              id="points_exact"
              name="points_exact"
              type="number"
              defaultValue={scoring.exact_score ?? 0}
            />
          </div>
        </div>
        <label htmlFor="description">Beschreibung</label>
        <input
          id="description"
          name="description"
          type="text"
          defaultValue={competition.description ?? ""}
        />
        <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          <input
            type="checkbox"
            name="requires_membership"
            defaultChecked={competition.requires_membership}
            style={{ width: 18, height: 18, accentColor: "var(--green)" }}
          />
          Kanal-Mitgliedschaft erforderlich
        </label>
        <button type="submit">SPEICHERN</button>
      </form>

      {/* ------------------------------------------------------- matches */}
      <h2>Spiele und Ergebnisse</h2>
      <div className="panel">
        {fixtures.length === 0 ? (
          <p className="muted">Noch keine Spiele zugeordnet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th className="wrap">Spiel</th>
                  <th>Anstoß</th>
                  <th>Status</th>
                  <th>Ergebnis</th>
                  <th>Korrigieren</th>
                </tr>
              </thead>
              <tbody>
                {fixtures.map((f) => (
                  <tr key={f.competition_fixture_id}>
                    <td>{f.position}</td>
                    <td className="wrap">
                      {f.home_team} — {f.away_team}
                    </td>
                    <td>{when(f.kickoff_at, tz)}</td>
                    <td>
                      <span className={`badge ${f.outcome ? "green" : ""}`}>{f.status}</span>
                    </td>
                    <td>
                      {f.outcome
                        ? `${f.home_goals}:${f.away_goals}`
                        : <span className="muted">offen</span>}
                    </td>
                    <td>
                      <form action={actionManualResult} className="actions">
                        <input type="hidden" name="fixture_id" value={f.fixture_id} />
                        <input type="hidden" name="competition_id" value={id} />
                        <input
                          name="home_goals"
                          type="number"
                          min="0"
                          defaultValue={f.home_goals ?? ""}
                          style={{ width: 62 }}
                          aria-label="Tore Heim"
                        />
                        <input
                          name="away_goals"
                          type="number"
                          min="0"
                          defaultValue={f.away_goals ?? ""}
                          style={{ width: 62 }}
                          aria-label="Tore Gast"
                        />
                        <button className="secondary small" type="submit">
                          Setzen
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          Ein von Hand gesetztes Ergebnis wird vom automatischen Import nicht
          mehr überschrieben. Nach dem Setzen wird sofort neu ausgewertet.
        </div>
      </div>

      {editableFixtures ? (
        <>
          <h2>Spiele ändern</h2>
          <form action={actionSetFixtures} className="panel">
            <input type="hidden" name="id" value={id} />
            <div className="hint" style={{ marginBottom: 8 }}>
              Nur möglich, solange der Wettbewerb im Entwurf oder noch offen
              ist. Danach würden bereits abgegebene Tipps ungültig.
            </div>
            {available.map((f) => (
              <label className="checkline" key={f.id}>
                <input
                  type="checkbox"
                  name="fixture"
                  value={f.id}
                  defaultChecked={chosen.has(f.id)}
                />
                <span>
                  <strong>{f.home_team}</strong> — <strong>{f.away_team}</strong>
                  <div className="hint">
                    {when(f.kickoff_at, tz)} · {f.league_name ?? "?"}
                  </div>
                </span>
              </label>
            ))}
            <button type="submit">SPIELE SPEICHERN</button>
          </form>
        </>
      ) : null}

      {/* ------------------------------------------------------- board */}
      <h2>Leaderboard</h2>
      <div className="panel">
        {board.length === 0 ? (
          <p className="muted">Noch keine Teilnehmer.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Platz</th>
                  <th>Nutzer</th>
                  <th>Punkte</th>
                  <th>Richtig</th>
                  <th>Exakt</th>
                </tr>
              </thead>
              <tbody>
                {board.map((row) => (
                  <tr key={row.user_id}>
                    <td>{row.rank ?? "-"}</td>
                    <td>{row.username ? `@${row.username}` : (row.first_name ?? "-")}</td>
                    <td>{row.points}</td>
                    <td>{row.correct_count}</td>
                    <td>{row.exact_hits}</td>
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

/** "MoneyRace #18" -> "MoneyRace #19", so duplicating suggests the next one. */
function nextName(name: string): string {
  const match = /^(.*?)(\d+)\s*$/.exec(name);
  if (!match) return `${name} (Kopie)`;
  return `${match[1]}${Number(match[2]) + 1}`;
}
