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
      active="/competitions"
      actions={<StatusBadge status={competition.status} />}
    >
      {flags.created ? <Notice>Competition created.</Notice> : null}
      {flags.saved ? <Notice>Saved.</Notice> : null}
      {flags.published ? (
        <Notice>
          Published. The channel announcement goes out within the next minute.
        </Notice>
      ) : null}
      {flags.drawn ? (
        <Notice>Winner drawn from {flags.drawn} participants.</Notice>
      ) : null}
      {flags.evaluated !== undefined ? (
        Number(flags.evaluated) > 0 ? (
          <Notice kind="warn">
            Evaluated, but {flags.evaluated} match(es) still have no result. No
            winner is named before every result is in.
          </Notice>
        ) : (
          <Notice>Evaluated. Every result is in.</Notice>
        )
      ) : null}
      {flags.error ? <Notice kind="bad">{flags.error}</Notice> : null}
      {competition.evaluation_note ? (
        <Notice kind="warn">⚠️ {competition.evaluation_note}</Notice>
      ) : null}

      <div className="cards">
        <div className="card">
          <div className="label">Prize money</div>
          <div className="value">{money(competition.prize_amount, competition.currency)}</div>
        </div>
        <div className="card">
          <div className="label">Participants</div>
          <div className="value">{counts?.participants ?? 0}</div>
          <div className="hint">{counts?.completed ?? 0} complete</div>
        </div>
        <div className="card">
          <div className="label">Matches</div>
          <div className="value">{fixtures.length}</div>
        </div>
        <div className="card">
          <div className="label">Lock</div>
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
              <button type="submit">PUBLISH</button>
            </form>
          ) : null}

          <form action={actionDuplicate}>
            <input type="hidden" name="id" value={id} />
            <input
              type="hidden"
              name="name"
              value={nextName(competition.name)}
            />
            <button className="secondary" type="submit">DUPLICATE</button>
          </form>

          {competition.type !== "giveaway" ? (
            <form action={actionEvaluate}>
              <input type="hidden" name="id" value={id} />
              <button className="secondary" type="submit">RE-EVALUATE</button>
            </form>
          ) : null}

          {competition.type === "giveaway" && !draw ? (
            <form action={actionDrawGiveaway}>
              <input type="hidden" name="id" value={id} />
              <button type="submit">🏆 DRAW A WINNER</button>
            </form>
          ) : null}

          {competition.status === "open" ? (
            <form action={actionSetStatus}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value="locked" />
              <button className="secondary" type="submit">LOCK NOW</button>
            </form>
          ) : null}

          <a className="button secondary" href={`/participants?competition=${id}`}>
            PARTICIPANTS
          </a>
          <a className="button secondary" href={`/leaderboards?competition=${id}`}>
            LEADERBOARD
          </a>
        </div>
      </div>

      {draw ? (
        <Notice>
          🎁 Drawn on {when(draw.drawn_at, tz)} from {draw.pool_size} participants.
          Winner: {draw.username ? `@${draw.username}` : "(no username)"}
        </Notice>
      ) : null}

      {/* ------------------------------------------------------- edit */}
      <h2>Basics</h2>
      <form action={actionUpdateCompetition} className="panel">
        <input type="hidden" name="id" value={id} />
        <div className="row">
          <div>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" defaultValue={competition.name} required />
          </div>
          <div>
            <label htmlFor="prize_amount">Prize money</label>
            <input
              id="prize_amount"
              name="prize_amount"
              type="number"
              step="0.01"
              defaultValue={competition.prize_amount}
            />
          </div>
          <div>
            <label htmlFor="currency">Currency</label>
            <input id="currency" name="currency" type="text" defaultValue={competition.currency} />
          </div>
          <div>
            <label htmlFor="winner_count">Number of winners</label>
            <input
              id="winner_count"
              name="winner_count"
              type="number"
              min="1"
              defaultValue={competition.winner_count}
            />
          </div>
          <div>
            <label htmlFor="opens_at">Starts</label>
            <input
              id="opens_at"
              name="opens_at"
              type="datetime-local"
              defaultValue={utcToZonedInput(competition.opens_at, tz)}
            />
          </div>
          <div>
            <label htmlFor="locks_at">Lock</label>
            <input
              id="locks_at"
              name="locks_at"
              type="datetime-local"
              defaultValue={utcToZonedInput(competition.locks_at, tz)}
            />
          </div>
          <div>
            <label htmlFor="ends_at">Ends</label>
            <input
              id="ends_at"
              name="ends_at"
              type="datetime-local"
              defaultValue={utcToZonedInput(competition.ends_at, tz)}
            />
          </div>
          <div>
            <label htmlFor="points_correct">Points, right outcome</label>
            <input
              id="points_correct"
              name="points_correct"
              type="number"
              defaultValue={scoring.correct_outcome ?? 1}
            />
          </div>
          <div>
            <label htmlFor="points_exact">Bonus, exact score</label>
            <input
              id="points_exact"
              name="points_exact"
              type="number"
              defaultValue={scoring.exact_score ?? 0}
            />
          </div>
        </div>
        <label htmlFor="description">Description</label>
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
          Channel membership required
        </label>
        <button type="submit">SAVE</button>
      </form>

      {/* ------------------------------------------------------- matches */}
      <h2>Matches and results</h2>
      <div className="panel">
        {fixtures.length === 0 ? (
          <p className="muted">No matches assigned yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th className="wrap">Match</th>
                  <th>Kick-off</th>
                  <th>Status</th>
                  <th>Result</th>
                  <th>Correct it</th>
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
                        : <span className="muted">open</span>}
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
                          aria-label="Home goals"
                        />
                        <input
                          name="away_goals"
                          type="number"
                          min="0"
                          defaultValue={f.away_goals ?? ""}
                          style={{ width: 62 }}
                          aria-label="Away goals"
                        />
                        <button className="secondary small" type="submit">
                          Set
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
          A result set by hand is never overwritten by the automatic import again.
          Setting one re-scores the competition immediately.
        </div>
      </div>

      {editableFixtures ? (
        <>
          <h2>Change matches</h2>
          <form action={actionSetFixtures} className="panel">
            <input type="hidden" name="id" value={id} />
            <div className="hint" style={{ marginBottom: 8 }}>
              Only possible while the competition is a draft or still open. After
              that, predictions already given would become invalid.
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
            <button type="submit">SAVE MATCHES</button>
          </form>
        </>
      ) : null}

      {/* ------------------------------------------------------- board */}
      <h2>Leaderboard</h2>
      <div className="panel">
        {board.length === 0 ? (
          <p className="muted">No participants yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>User</th>
                  <th>Points</th>
                  <th>Correct</th>
                  <th>Exact</th>
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
  if (!match) return `${name} (copy)`;
  return `${match[1]}${Number(match[2]) + 1}`;
}
