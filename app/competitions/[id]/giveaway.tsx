/**
 * Everything a giveaway needs and a MoneyRace does not.
 *
 * Kept in its own file because that is the point of the whole change: a
 * giveaway is not a MoneyRace with the football hidden. It has no matches, no
 * predictions, no lock and no points, and none of those words appear here.
 *
 * The three actions are deliberately three buttons in order - draw, tell the
 * winner, announce it - because they are three different commitments. Drawing
 * decides who won and can never be undone. Telling them is a message that can
 * fail and be tried again. Announcing publishes a name to a channel, and he may
 * decide not to.
 */
import { giveawayStage } from "@/lib/admin.ts";
import { publicWinnerName, type GiveawayEntrant, type GiveawayWinner } from "@/lib/giveaway.ts";
import { money, whenAdmin } from "@/lib/templates.ts";
import { Notice } from "../../shell.tsx";
import {
  actionAnnounceWinner,
  actionDrawGiveaway,
  actionNotifyWinner,
  actionPrizeNote,
} from "../../actions.ts";

export function GiveawayPanel({
  id,
  competition,
  winner,
  entrants,
  tz,
}: {
  id: number;
  competition: any;
  winner: GiveawayWinner | null;
  entrants: GiveawayEntrant[];
  tz: string;
}) {
  const stage = giveawayStage(
    competition,
    Boolean(winner),
    winner?.prize_status ?? null,
  );

  return (
    <>
      <h2>Giveaway</h2>
      <div className="panel">
        <div className="cards" style={{ marginBottom: 14 }}>
          <div className="card">
            <div className="label">Stage</div>
            <div className="value" style={{ fontSize: 19 }}>{stage}</div>
          </div>
          <div className="card">
            <div className="label">Participants</div>
            <div className="value">{entrants.length.toLocaleString("en-GB")}</div>
          </div>
          <div className="card">
            <div className="label">Prize</div>
            <div className="value">
              {money(competition.prize_amount, competition.currency)}
            </div>
          </div>
        </div>

        {!winner ? (
          <>
            <p className="hint" style={{ marginBottom: 10 }}>
              One entrant is chosen at random from everyone above. The draw is
              recorded with the pool it was taken from and cannot be run twice —
              a winner is never quietly replaced.
            </p>
            <form action={actionDrawGiveaway}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" disabled={entrants.length === 0}>
                🏆 DRAW A WINNER
              </button>
            </form>
            {entrants.length === 0 ? (
              <div className="hint" style={{ marginTop: 8 }}>
                Nobody has entered yet, so there is nothing to draw from.
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Notice>
              <strong>🏆 Winner drawn</strong>
              <div style={{ marginTop: 6 }}>
                {winner.username ? `@${winner.username}` : "(no public username)"} ·
                Telegram ID <span className="mono">{winner.telegram_id}</span>
              </div>
              <div className="hint">
                {whenAdmin(winner.drawn_at, tz)} · drawn from {winner.pool_size}{" "}
                participants · draw <span className="mono">{winner.seed}</span>
              </div>
            </Notice>

            {/* ---- tell them */}
            <div style={{ marginTop: 14 }}>
              <strong>1. Tell the winner</strong>
              <div className="hint" style={{ margin: "4px 0 8px" }}>
                A private message from the bot, in German, from the &quot;message to
                the winner&quot; template.
              </div>
              {winner.notified_at ? (
                <div style={{ color: "var(--green)" }}>
                  ✅ Sent {whenAdmin(winner.notified_at, tz)}
                </div>
              ) : winner.notify_error ? (
                <Notice kind="bad">
                  ⚠️ The winner could not be told. {winner.notify_error}
                </Notice>
              ) : null}
              <form action={actionNotifyWinner} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={id} />
                <button className="secondary" type="submit">
                  {winner.notified_at ? "SEND IT AGAIN" : "📩 TELL THE WINNER"}
                </button>
              </form>
            </div>

            {/* ---- announce it */}
            <div style={{ marginTop: 18 }}>
              <strong>2. Announce it in the channel</strong>
              <div className="hint" style={{ margin: "4px 0 8px" }}>
                {competition.announce_winner_publicly ? (
                  <>
                    The channel post will name{" "}
                    <strong>{publicWinnerName(winner.username)}</strong>. No Telegram
                    ID, no real name, no participant list — ever.
                  </>
                ) : (
                  <>
                    &quot;Name the winner publicly&quot; is off for this giveaway, so
                    the channel post says a winner was drawn and told, without naming
                    anyone. Change it under Basics.
                  </>
                )}
              </div>
              {competition.winner_announced_at ? (
                <div style={{ color: "var(--green)", marginBottom: 8 }}>
                  ✅ Announced {whenAdmin(competition.winner_announced_at, tz)}
                </div>
              ) : null}
              <form action={actionAnnounceWinner}>
                <input type="hidden" name="id" value={id} />
                <button className="secondary" type="submit">
                  📢 ANNOUNCE THE WINNER
                </button>
              </form>
            </div>

            {/* ---- pay them */}
            {winner.prize_id ? (
              <form action={actionPrizeNote} style={{ marginTop: 18 }}>
                <input type="hidden" name="competition_id" value={id} />
                <input type="hidden" name="prize_id" value={winner.prize_id} />
                <strong>3. Pay the prize</strong>
                <div className="hint" style={{ margin: "4px 0 8px" }}>
                  The system never moves money. This is your own record of it.
                  Currently{" "}
                  <strong>
                    {winner.prize_status === "paid" ? "🟢 paid" : "🟡 outstanding"}
                  </strong>
                  .
                </div>
                <label htmlFor="notes">Note</label>
                <input
                  id="notes"
                  name="notes"
                  type="text"
                  defaultValue={winner.notes ?? ""}
                  placeholder="e.g. Paid on 30/08/2026 by PayPal"
                />
                {winner.prize_status !== "paid" ? (
                  <label
                    style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}
                  >
                    <input
                      type="checkbox"
                      name="mark_paid"
                      style={{ width: 18, height: 18, accentColor: "var(--green)" }}
                    />
                    Mark the prize as paid
                  </label>
                ) : null}
                <button className="secondary" type="submit" style={{ marginTop: 10 }}>
                  SAVE
                </button>
              </form>
            ) : null}
          </>
        )}
      </div>

      <h2>Participants</h2>
      <div className="panel">
        <div className="hint" style={{ marginBottom: 10 }}>
          Admin only. Nothing on this list is ever shown to a player, in the bot or
          on the website — a participant can only see their own entry.
        </div>
        {entrants.length === 0 ? (
          <p className="muted">Nobody has entered yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Telegram ID</th>
                  <th>Entered</th>
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {entrants.map((e) => (
                  <tr key={e.user_id}>
                    <td>{e.username ? `@${e.username}` : (e.first_name ?? "-")}</td>
                    <td className="mono muted">{e.telegram_id}</td>
                    <td>{whenAdmin(e.joined_at, tz)}</td>
                    <td>{e.is_winner ? "🏆" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
