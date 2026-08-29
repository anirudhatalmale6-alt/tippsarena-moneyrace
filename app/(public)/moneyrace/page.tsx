/**
 * tippsarena.com/moneyrace - the Facebook ad landing page.
 *
 * Built for one job: turn a paid click into a /start in the bot. That means the
 * call to action is above the fold and repeated three times, the page names the
 * prize and the deadline in the first screen, and every objection ("what does
 * it cost", "is this betting", "how long does it take") is answered before the
 * last button rather than after it.
 *
 * Every figure on this page is read out of the database. If there is no open
 * competition the page does not invent one - it says the next round is being
 * prepared and still sends the click into the bot, which is where the next
 * announcement will reach them.
 */
import type { Metadata } from "next";
import { botLink, nextCompetition, publicStats } from "@/lib/public.ts";
import { Footer, Header, Section, euro, germanWhen } from "../parts.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TippsArena MoneyRace — Tippen, gewinnen, kostenlos",
  description:
    "Tippe die Fußballspiele des Wochenendes und spiele um echtes Preisgeld. "
    + "Kostenlos, kein Einsatz, direkt in Telegram. Dauert 60 Sekunden.",
  openGraph: {
    title: "TippsArena MoneyRace — Tippen, gewinnen, kostenlos",
    description:
      "Tippe die Spiele des Wochenendes und spiele um echtes Preisgeld. "
      + "Kostenlos, kein Einsatz, direkt in Telegram.",
    type: "website",
    locale: "de_DE",
  },
};

export default async function MoneyRacePage() {
  const [competition, stats, cta] = await Promise.all([
    nextCompetition(),
    publicStats(),
    botLink("fb_moneyrace"),
  ]);

  const prize = competition
    ? euro(competition.prize_amount, competition.currency)
    : null;

  return (
    <>
      <Header active="/moneyrace" />

      {/* ------------------------------------------------------------ hero */}
      <div className="lp-hero">
        <div className="lp-wrap">
          <span className="lp-kicker">Kostenlos · Kein Einsatz</span>
          <h1>
            Tippe das Wochenende.<br />
            Gewinne <em>echtes Preisgeld</em>.
          </h1>
          <p className="lp-sub">
            {prize
              ? `${prize} liegen in der laufenden Runde. Du tippst nur, wer gewinnt — Heim, Unentschieden oder Auswärts. Mehr nicht.`
              : "Du tippst nur, wer gewinnt — Heim, Unentschieden oder Auswärts. Mehr nicht. Die nächste Runde startet in Kürze."}
          </p>

          <div className="lp-ctas">
            <a className="lp-cta" href={cta}>
              🏁 JETZT KOSTENLOS MITSPIELEN
            </a>
          </div>
          <p className="lp-note">
            Läuft in Telegram · Anmeldung dauert 10 Sekunden · Kein Geld, keine
            Kreditkarte, keine Wette
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------- the prize */}
      {competition ? (
        <Section>
          <div className="lp-prize">
            <div className="lp-badge lp-live">Läuft gerade</div>
            <div className="lp-amount" style={{ marginTop: 10 }}>
              {prize}
            </div>
            <div className="lp-meta">
              {competition.name}
              <br />
              Tippschluss: <strong>{germanWhen(competition.locks_at)}</strong>
              {competition.participants > 0 ? (
                <>
                  <br />
                  {competition.participants} Teilnehmer sind schon dabei
                </>
              ) : null}
            </div>
            <div className="lp-ctas" style={{ marginTop: 18 }}>
              <a className="lp-cta" href={cta}>
                TIPPS ABGEBEN
              </a>
            </div>
          </div>
        </Section>
      ) : null}

      {/* ------------------------------------------------------- how it works */}
      <Section
        title="In 60 Sekunden dabei"
        lead="Kein Formular, kein Konto, keine App. Nur Telegram."
      >
        <div className="lp-grid">
          <div className="lp-card">
            <span className="lp-step">1</span>
            <h3>Bot starten</h3>
            <p>
              Ein Tipp auf den Button öffnet den TippsArena-Bot in Telegram.
              Fertig, du bist angemeldet.
            </p>
          </div>
          <div className="lp-card">
            <span className="lp-step">2</span>
            <h3>Spiele tippen</h3>
            <p>
              Du bekommst die Spiele einzeln. Pro Spiel ein Tipp: Heim,
              Unentschieden oder Auswärts.
            </p>
          </div>
          <div className="lp-card">
            <span className="lp-step">3</span>
            <h3>Preisgeld kassieren</h3>
            <p>
              Nach dem letzten Abpfiff wird automatisch gewertet. Wer die
              meisten Punkte hat, gewinnt.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ numbers */}
      {stats.players > 0 || stats.competitions_finished > 0 ? (
        <Section>
          <div className="lp-grid lp-4">
            <div className="lp-card lp-stat">
              <div className="lp-n">{stats.players}</div>
              <div className="lp-l">Spieler</div>
            </div>
            <div className="lp-card lp-stat">
              <div className="lp-n">{stats.competitions_finished}</div>
              <div className="lp-l">Runden gespielt</div>
            </div>
            <div className="lp-card lp-stat">
              <div className="lp-n">{euro(stats.prize_open)}</div>
              <div className="lp-l">Preisgeld im Rennen</div>
            </div>
            <div className="lp-card lp-stat">
              <div className="lp-n">0 €</div>
              <div className="lp-l">Einsatz</div>
            </div>
          </div>
        </Section>
      ) : null}

      {/* ---------------------------------------------------------- objections */}
      <Section title="Der Haken? Gibt es nicht.">
        <div className="lp-grid lp-2">
          <div className="lp-card">
            <h3>💸 Kostet nichts</h3>
            <p>
              Kein Einsatz, kein Abo, keine Zahlungsdaten. Du spielst um das
              Preisgeld, nicht mit deinem eigenen Geld.
            </p>
          </div>
          <div className="lp-card">
            <h3>🎯 Keine Wette</h3>
            <p>
              Kein Wettanbieter, keine Quoten, kein Risiko. Ein Tippspiel unter
              Fans — wer am besten tippt, gewinnt.
            </p>
          </div>
          <div className="lp-card">
            <h3>⏱️ Dauert eine Minute</h3>
            <p>
              Die Spiele kommen einzeln, du tippst mit einem Tap. Vom Start bis
              zum letzten Tipp vergeht kaum mehr als eine Minute.
            </p>
          </div>
          <div className="lp-card">
            <h3>⚖️ Nachvollziehbar</h3>
            <p>
              Nach Tippschluss ist kein Tipp mehr änderbar, gewertet wird
              automatisch nach den offiziellen Ergebnissen. Die Tabelle steht{" "}
              <a href="/leaderboard" style={{ color: "#22c55e" }}>
                öffentlich hier
              </a>
              .
            </p>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------------- faq */}
      <Section title="Häufige Fragen">
        <div className="lp-faq">
          <details>
            <summary>Muss ich wirklich nichts bezahlen?</summary>
            <p>
              Nein. Die Teilnahme ist kostenlos und bleibt es. Es gibt keinen
              Einsatz und keine Bezahlseite.
            </p>
          </details>
          <details>
            <summary>Wie wird gewertet?</summary>
            <p>
              Pro richtig getipptem Spielausgang gibt es einen Punkt. Bei
              Punktgleichheit entscheidet, wer seine Tipps früher abgegeben hat.
              Die Ergebnisse kommen automatisch vom offiziellen Datenanbieter.
            </p>
          </details>
          <details>
            <summary>Kann ich meine Tipps noch ändern?</summary>
            <p>
              Bis zum Tippschluss ja, so oft du willst. Danach ist alles
              gesperrt — auch für uns. Deine Teilnahme zählt einmal, egal wie
              oft du den Bot öffnest.
            </p>
          </details>
          <details>
            <summary>Wie bekomme ich das Preisgeld?</summary>
            <p>
              Der Gewinner wird im Kanal bekannt gegeben und über den Bot
              kontaktiert. Die Auszahlung wird direkt mit dir abgestimmt.
            </p>
          </details>
          <details>
            <summary>Brauche ich Telegram?</summary>
            <p>
              Ja, das ganze Spiel läuft dort. Telegram ist kostenlos und in
              einer Minute installiert.
            </p>
          </details>
        </div>
      </Section>

      {/* ----------------------------------------------------------- last cta */}
      <Section>
        <div className="lp-prize">
          <h2 style={{ margin: "0 0 6px" }}>
            {competition ? "Die Runde läuft. Bis Tippschluss." : "Die nächste Runde startet bald."}
          </h2>
          <p className="lp-meta" style={{ marginBottom: 18 }}>
            {competition
              ? `${prize} · Tippschluss ${germanWhen(competition.locks_at)}`
              : "Starte den Bot — du bekommst die nächste Runde als Erster."}
          </p>
          <a className="lp-cta" href={cta}>
            🏁 JETZT KOSTENLOS MITSPIELEN
          </a>
        </div>
      </Section>

      <Footer />
    </>
  );
}
