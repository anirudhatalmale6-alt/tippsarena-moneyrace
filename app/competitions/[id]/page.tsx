/**
 * One competition: edit it, choose its matches, publish it, correct a result,
 * draw a giveaway, re-evaluate (spec §14, §16, §17, §27, §12).
 */
import { notFound } from "next/navigation";
import { competitionFixtures, leaderboard } from "@/lib/competitions.ts";
import { publishReadiness, visibility } from "@/lib/admin.ts";
import { AUDIENCES, audienceSize } from "@/lib/broadcast.ts";
import { giveawayEntrants, giveawayWinner } from "@/lib/giveaway.ts";
import { GiveawayPanel } from "./giveaway.tsx";
import { getSetting, one, query } from "@/lib/db.ts";
import { money, utcToZonedInput, whenAdmin } from "@/lib/templates.ts";
import { Notice, Shell, StatusBadge, requireAdmin } from "../../shell.tsx";
import {
  actionAnnounce,
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
  const isGiveaway = competition.type === "giveaway";
  const isExact = competition.type === "exact_score";
  const winner = isGiveaway ? await giveawayWinner(id) : null;
  const entrants = isGiveaway ? await giveawayEntrants(id, 200) : [];

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
  const readiness = await publishReadiness(id);
  const seen = visibility(competition);
  const reach = await audienceSize();
  const channelSet = Boolean(await getSetting<string>("channel_chat_id", null));

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
      {flags.announced !== undefined ? (
        <Notice>
          Announcement queued
          {flags.to === "channel"
            ? " for the channel"
            : ` for ${flags.announced} bot user(s)${flags.to === "both" ? " and the channel" : ""}`}
          . It goes out within the next minute.
        </Notice>
      ) : null}
      {flags.drawn ? (
        <Notice>
          Winner drawn from {flags.drawn} participants. Nothing has been sent yet —
          telling the winner and announcing it are the two buttons below.
        </Notice>
      ) : null}
      {flags.notified ? <Notice>The winner has been told privately.</Notice> : null}
      {flags.notify_failed ? (
        <Notice kind="bad">
          ⚠️ The winner could not be told. {flags.notify_failed} You can try again
          below; the draw itself stands either way.
        </Notice>
      ) : null}
      {flags.winner_announced ? (
        <Notice>
          The channel announcement is queued and goes out within the next minute.
        </Notice>
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
      {flags.confirm_result ? (
        <Notice kind="warn">
          <strong>That match has not kicked off yet.</strong>
          <div style={{ marginTop: 4 }}>
            Results arrive from the football API by themselves, usually a few
            minutes after the final whistle. Typing one now stops the API from
            ever touching this match again, and {flags.home}:{flags.away} becomes
            the score this competition is settled on.
          </div>
          <form action={actionManualResult} style={{ marginTop: 10 }}>
            <input type="hidden" name="fixture_id" value={flags.confirm_result} />
            <input type="hidden" name="competition_id" value={id} />
            <input type="hidden" name="home_goals" value={flags.home} />
            <input type="hidden" name="away_goals" value={flags.away} />
            <input type="hidden" name="confirm" value="1" />
            <button className="secondary" type="submit">
              Yes, set it to {flags.home}:{flags.away} anyway
            </button>
          </form>
        </Notice>
      ) : null}
      {competition.evaluation_note ? (
        <Notice kind="warn">⚠️ {competition.evaluation_note}</Notice>
      ) : null}

      {/* Match count and "complete" mean nothing in a giveaway - there is
          nothing to predict and nothing to complete. Same rule as the bot. */}
      <div className="cards">
        <div className="card">
          <div className="label">{isGiveaway ? "Prize" : "Prize money"}</div>
          <div className="value">{money(competition.prize_amount, competition.currency)}</div>
        </div>
        <div className="card">
          <div className="label">Participants</div>
          <div className="value">{counts?.participants ?? 0}</div>
          {!isGiveaway ? (
            <div className="hint">{counts?.completed ?? 0} complete</div>
          ) : null}
        </div>
        {!isGiveaway ? (
          <div className="card">
            <div className="label">{isExact ? "Match" : "Matches"}</div>
            <div className="value">{fixtures.length}</div>
          </div>
        ) : (
          <div className="card">
            <div className="label">Winners</div>
            <div className="value">{competition.winner_count}</div>
          </div>
        )}
        <div className="card">
          <div className="label">{isGiveaway ? "Closes" : "Lock"}</div>
          <div className="value" style={{ fontSize: 17 }}>
            {whenAdmin(competition.locks_at, tz)}
          </div>
        </div>
      </div>

      {/* --------------------------------------------------- is it live? */}
      <div
        className="panel"
        style={{
          marginTop: 18,
          borderColor: seen.visible ? "var(--green)" : "var(--amber, #d99a2b)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 20 }}>{seen.visible ? "🟢" : "⚪"}</span>
          <strong style={{ fontSize: 17 }}>{seen.label}</strong>
          <span className="muted">{seen.detail}</span>
        </div>

        {!seen.visible && competition.status === "draft" ? (
          <div style={{ marginTop: 12 }}>
            {readiness.ready ? (
              <p className="hint" style={{ marginBottom: 10 }}>
                Everything it needs is in place. Press PUBLISH and it appears in the
                bot under &quot;Enter a competition&quot;.
              </p>
            ) : (
              <>
                <p className="hint" style={{ marginBottom: 6 }}>
                  It cannot go live yet:
                </p>
                <ul style={{ margin: "0 0 12px 18px", lineHeight: 1.7 }}>
                  {readiness.blockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </>
            )}
            {readiness.warnings.map((warning) => (
              <p className="hint" key={warning}>
                ⚠️ {warning}
              </p>
            ))}
            <form action={actionPublish}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" disabled={!readiness.ready}>
                PUBLISH — MAKE IT VISIBLE IN THE BOT
              </button>
            </form>
          </div>
        ) : null}

        {/* --------------------------------------------------- announce it.
            Only once it is actually live: an advert for a competition nobody
            can enter yet sends everyone to a locked door, and there is no way
            to unsend it. */}
        {competition.status === "open" ? (
          <form action={actionAnnounce} style={{ marginTop: 16 }}>
            <input type="hidden" name="id" value={id} />
            {/* No key: the action picks the template from the competition
                type, so a giveaway can never go out worded as a MoneyRace. */}
            <label htmlFor="audience">Announce this competition to</label>
            <select id="audience" name="audience" defaultValue="both">
              {AUDIENCES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <div className="hint" style={{ marginTop: 6 }}>
              {reach} user(s) have started the bot and can be reached by direct
              message.{" "}
              {channelSet
                ? "The channel is connected."
                : "No channel is connected yet, so the channel half waits until one is."}{" "}
              The wording comes from the{" "}
              {isGiveaway ? '"Channel: giveaway"' : '"Channel: new competition"'}{" "}
              template on the <a href="/telegram">Telegram</a> page — edit it there
              first if you want to change it.
            </div>
            <button className="secondary" type="submit" style={{ marginTop: 10 }}>
              📢 ANNOUNCE
            </button>
          </form>
        ) : null}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="actions">
          <form action={actionDuplicate}>
            <input type="hidden" name="id" value={id} />
            <input
              type="hidden"
              name="name"
              value={nextName(competition.name)}
            />
            <button className="secondary" type="submit">DUPLICATE</button>
          </form>

          {!isGiveaway ? (
            <form action={actionEvaluate}>
              <input type="hidden" name="id" value={id} />
              <button className="secondary" type="submit">RE-EVALUATE</button>
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

      {isGiveaway ? (
        <GiveawayPanel
          id={id}
          competition={competition}
          winner={winner}
          entrants={entrants}
          tz={tz}
        />
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
            <label htmlFor="locks_at">{isGiveaway ? "Closes" : "Lock"}</label>
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
          {!isGiveaway ? (
          <div>
            <label htmlFor="points_correct">Points, right outcome</label>
            <input
              id="points_correct"
              name="points_correct"
              type="number"
              defaultValue={scoring.correct_outcome ?? 1}
            />
          </div>
          ) : null}
          {!isGiveaway ? (
          <div>
            <label htmlFor="points_exact">
              {isExact ? "Extra points, exact score" : "Bonus, exact score"}
            </label>
            <input
              id="points_exact"
              name="points_exact"
              type="number"
              defaultValue={scoring.exact_score ?? 0}
            />
          </div>
          ) : null}
        </div>
        {isExact ? (
          <div className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
            The two point boxes are added together, so a right outcome with the
            wrong score pays the first, and an exact score pays both. 1 and 2 gives
            you 3 points for an exact hit and 1 for the right outcome — nothing here
            is fixed in the code.
          </div>
        ) : null}
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
        {isGiveaway ? (
          <>
            <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
              <input
                type="checkbox"
                name="announce_winner_publicly"
                defaultChecked={competition.announce_winner_publicly}
                style={{ width: 18, height: 18, accentColor: "var(--green)" }}
              />
              Name the winner publicly
            </label>
            <div className="hint" style={{ marginTop: 4 }}>
              On, the channel post says &quot;@name has won&quot; — username only,
              and only if they have one. Off, it says a winner was drawn and told,
              without naming anyone. Either way the winner still gets their private
              message, and the participant list is never published.
            </div>
          </>
        ) : null}
        <button type="submit">SAVE</button>
      </form>

      {/* ------------------------------------------------------- matches */}
      {!isGiveaway ? (
      <>
      <h2>{isExact ? "The match and its result" : "Matches and results"}</h2>
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
                    <td>{whenAdmin(f.kickoff_at, tz)}</td>
                    <td>
                      <span className={`badge ${f.outcome ? "green" : ""}`}>{f.status}</span>
                    </td>
                    <td>
                      {f.outcome ? (
                        <>
                          {f.home_goals}:{f.away_goals}
                          <div className="hint">
                            {f.manual ? "typed by hand" : "from the API"}
                          </div>
                        </>
                      ) : (
                        <span className="muted">waiting for the API</span>
                      )}
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
                      {f.manual ? (
                        <form action={actionManualResult} style={{ marginTop: 6 }}>
                          <input type="hidden" name="fixture_id" value={f.fixture_id} />
                          <input type="hidden" name="competition_id" value={id} />
                          <input type="hidden" name="clear" value="1" />
                          <button className="secondary small" type="submit">
                            ↩︎ Let the API fill it
                          </button>
                        </form>
                      ) : null}
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
              {isExact
                ? "An exact-score competition is normally one match. Only changeable while it is a draft or still open - after that, predictions already given would become invalid."
                : "Only possible while the competition is a draft or still open. After that, predictions already given would become invalid."}
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
                    {whenAdmin(f.kickoff_at, tz)} · {f.league_name ?? "?"}
                  </div>
                </span>
              </label>
            ))}
            <button type="submit">SAVE MATCHES</button>
          </form>
        </>
      ) : null}
      </>
      ) : null}

      {/* ------------------------------------------------------- board.
          A giveaway has no points, so a points table would be a column of
          zeros in a meaningless order. Its own panel above lists the entrants. */}
      {!isGiveaway ? (
      <>
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
      </>
      ) : null}
    </Shell>
  );
}

/** "MoneyRace #18" -> "MoneyRace #19", so duplicating suggests the next one. */
function nextName(name: string): string {
  const match = /^(.*?)(\d+)\s*$/.exec(name);
  if (!match) return `${name} (copy)`;
  return `${match[1]}${Number(match[2]) + 1}`;
}
