/**
 * tippsarena.com/leaderboard - every competition, in public.
 *
 * Names are masked to one letter and six stars (his instruction, 29 Aug). The
 * masking happens in lib/public.ts, which is the only thing these pages read
 * from - no Telegram id, no full username and no real name is fetched here at
 * all, so there is nothing on the page that could leak by accident.
 */
import type { Metadata } from "next";
import { publicAllTime, publicBoards } from "@/lib/public.ts";
import { Footer, Header, Section, euro, germanWhen } from "../parts.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard — TippsArena MoneyRace",
  description:
    "Alle Ergebnisse und Ranglisten der TippsArena MoneyRace: laufende Runden, "
    + "beendete Runden und die ewige Bestenliste.",
  openGraph: {
    title: "Leaderboard — TippsArena MoneyRace",
    description: "Alle Ergebnisse und Ranglisten der TippsArena MoneyRace.",
    type: "website",
    locale: "de_DE",
  },
};

const MEDALS = ["🥇", "🥈", "🥉"];

const STATUS: Record<string, [string, string]> = {
  open:       ["Läuft", "lp-live"],
  locked:     ["Gesperrt", ""],
  evaluating: ["Auswertung läuft", ""],
  finished:   ["Beendet", "lp-done"],
};

export default async function LeaderboardPage() {
  const [boards, allTime] = await Promise.all([
    publicBoards(20),
    publicAllTime(20),
  ]);

  return (
    <>
      <Header active="/leaderboard" />

      <div className="lp-hero" style={{ padding: "40px 0 30px" }}>
        <div className="lp-wrap">
          <span className="lp-kicker">Öffentliche Rangliste</span>
          <h1 style={{ fontSize: "clamp(26px, 5vw, 42px)" }}>Leaderboard</h1>
          <p className="lp-sub">
            Jede Runde, jede Wertung, für alle einsehbar. Namen werden gekürzt
            angezeigt — jeder erkennt sich selbst, niemand sonst.
          </p>
        </div>
      </div>

      {/* -------------------------------------------------------- per round */}
      <Section title="Alle Runden">
        {boards.length === 0 ? (
          <p className="lp-lead">
            Es wurde noch keine Runde veröffentlicht. Sobald die erste läuft,
            steht sie hier.
          </p>
        ) : (
          boards.map((board) => {
            const [label, tone] = STATUS[board.status] ?? [board.status, ""];
            return (
              <div className="lp-card lp-board" key={board.id}>
                <div className="lp-board-head">
                  <h3>{board.name}</h3>
                  <span className={`lp-badge ${tone}`}>{label}</span>
                </div>
                <div className="lp-board-head" style={{ marginTop: -4 }}>
                  <span className="lp-meta">
                    💰 {euro(board.prize_amount, board.currency)} ·{" "}
                    👥 {board.participants} Teilnehmer ·{" "}
                    🔒 {germanWhen(board.locks_at)}
                  </span>
                </div>

                {board.rows.length === 0 ? (
                  <p style={{ color: "#93a3b4", margin: 0 }}>
                    Noch keine Teilnehmer in dieser Runde.
                  </p>
                ) : (
                  <div className="lp-table-wrap">
                    <table className="lp-table">
                      <thead>
                        <tr>
                          <th className="lp-rank">Platz</th>
                          <th>Spieler</th>
                          <th>Punkte</th>
                          <th>Richtig</th>
                        </tr>
                      </thead>
                      <tbody>
                        {board.rows.map((row, i) => (
                          <tr key={i}>
                            <td className="lp-rank">
                              {MEDALS[i] ?? (row.rank ?? i + 1)}
                            </td>
                            <td className="lp-mono">{row.name}</td>
                            <td className="lp-mono">
                              <strong>{row.points}</strong>
                            </td>
                            <td className="lp-mono">{row.correct}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </Section>

      {/* --------------------------------------------------------- all time */}
      <Section
        title="🏅 Ewige Bestenliste"
        lead="Punkte aus allen beendeten Runden zusammen."
      >
        <div className="lp-card">
          {allTime.length === 0 ? (
            <p style={{ color: "#93a3b4", margin: 0 }}>
              Noch keine beendete Runde.
            </p>
          ) : (
            <div className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    <th className="lp-rank">Platz</th>
                    <th>Spieler</th>
                    <th>Punkte</th>
                    <th>Richtig</th>
                  </tr>
                </thead>
                <tbody>
                  {allTime.map((row, i) => (
                    <tr key={i}>
                      <td className="lp-rank">{MEDALS[i] ?? row.rank}</td>
                      <td className="lp-mono">{row.name}</td>
                      <td className="lp-mono">
                        <strong>{row.points}</strong>
                      </td>
                      <td className="lp-mono">{row.correct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      <Section>
        <div className="lp-prize">
          <h2 style={{ margin: "0 0 6px" }}>Auch auf die Liste?</h2>
          <p className="lp-meta" style={{ marginBottom: 18 }}>
            Kostenlos mitspielen, kein Einsatz, läuft komplett in Telegram.
          </p>
          <a className="lp-cta" href="/moneyrace">
            🏁 SO FUNKTIONIERT ES
          </a>
        </div>
      </Section>

      <Footer />
    </>
  );
}
