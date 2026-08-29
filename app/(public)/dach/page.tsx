/**
 * tippsarena.com/dach - the second paid-traffic page.
 *
 * He asked for a page for Facebook ads that is NOT the MoneyRace page. So this
 * one sells a different thing to a different feeling: not "there is money on
 * the table" but "you already argue about football every weekend - here is
 * where you get to be right in front of people".
 *
 * Deliberately different from /moneyrace in headline, hook, proof and copy, so
 * the two can be run against each other and the winner actually means
 * something. Same single action, and its own campaign code fb_dach.
 */
import type { Metadata } from "next";
import { botLink, channelLink, nextCompetition, publicStats } from "@/lib/public.ts";
import { Footer, Header, Section, euro, germanWhen } from "../parts.tsx";
import { Countdown } from "../countdown.tsx";
import { Cta, Facts, Legal, Mark, Pains, Preview, Quote, Ticker } from "../ad.tsx";
import { StickyCta } from "../sticky.tsx";
import "../public.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TippsArena — Die Tipprunde für Deutschland, Österreich und die Schweiz",
  description:
    "Jede Woche gegen andere Fußballfans tippen. Kostenlos, ohne Einsatz, direkt in Telegram. Beweise, dass du mehr Ahnung hast.",
};

export default async function DachPage() {
  const competition = await nextCompetition();
  const stats = await publicStats();
  const link = await botLink("fb_dach");
  const channel = await channelLink();
  const hasRace = Boolean(competition?.locks_at);

  return (
    <div className="lp lp-ad">
      <Ticker
        items={[
          "Deutschland · Österreich · Schweiz",
          "Jede Woche eine neue Runde",
          "Kostenlos ohne Einsatz",
          "Nur Telegram, sonst nichts",
          "Bundesliga · 2. Liga · Europa",
        ]}
      />
      <Header active="/dach" />

      {/* ------------------------------------------------------------ hero */}
      <section className="lp-hero">
        <div className="lp-wrap">
          <Mark />
          <div className="lp-eyebrow">Deutschland · Österreich · Schweiz</div>
          <h1>
            Jeder am Tisch weiß es besser.
            <br />
            <em>Beweis es.</em>
          </h1>
          <p className="lp-sub">
            Jede Woche eine neue Tipprunde gegen andere Fußballfans aus dem
            DACH-Raum. Kostenlos, ohne Einsatz, direkt in Telegram. Am Montag
            steht schwarz auf weiß, wer recht hatte.
          </p>

          <div className="lp-pill">Kein Einsatz · Keine Wette · Kein Konto</div>

          <div className="lp-ctas">
            <Cta href={link}>⚽ Kostenlos mitspielen</Cta>
          </div>
          <p className="lp-note">
            Ein Klick, Telegram öffnet sich, du bist drin. Keine E-Mail, keine
            Kreditkarte, keine Registrierung.
          </p>

          <Facts
            items={[
              ["0 €", "Einsatz"],
              ["< 1 Min", "pro Runde"],
              ["Jede Woche", "eine neue Runde"],
            ]}
          />

          {hasRace ? (
            <div className="lp-pot" style={{ marginTop: 30 }}>
              <div className="lp-for">Diese Woche läuft</div>
              <div style={{ fontSize: 21, fontWeight: 800, margin: "6px 0 4px" }}>
                {competition!.name}
              </div>
              <Countdown target={new Date(competition!.locks_at!).toISOString()} />
              <div className="lp-note">
                Tippschluss: {germanWhen(competition!.locks_at)}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------------ pains */}
      <Section
        title="Für alle, die am Wochenende sowieso mitreden"
        lead="Du musst kein Experte sein. Eine Meinung reicht."
      >
        <Pains
          items={[
            "Du diskutierst jedes Wochenende über Aufstellungen — hier zählt es endlich.",
            "Du willst nicht wetten und trotzdem mitfiebern.",
            "Du hast keine Lust auf Quoten, Systeme und Tabellen lesen.",
            "Eine Runde dauert unter einer Minute. Kein Zeitfresser.",
            "Bundesliga, 2. Liga und die großen europäischen Spiele — die, über die alle reden.",
            "Keine App installieren, kein Konto anlegen: Telegram hast du schon.",
          ]}
        />
      </Section>

      {/* -------------------------------------------------- what it looks like */}
      <Section
        title="So sieht es im Bot aus"
        lead="Kein Formular, keine Anmeldung. Ein Chat, drei Knöpfe."
      >
        <Preview
          lines={[
            ["⚽ <b>Spieltag 3</b><br/>5 Spiele. Tippschluss Samstag 15:25.", false],
            ["⚽ <b>Union Berlin — Frankfurt</b><br/>Wer gewinnt?", false],
            ["🤝 Unentschieden", true],
            ["✅ Gespeichert. Noch 4 Spiele.", false],
          ]}
        />
      </Section>

      {/* ------------------------------------------------------------ steps */}
      <Section title="So läuft eine Runde">
        <div className="lp-grid">
          <div className="lp-card">
            <span className="lp-step">1</span>
            <h3>Vor dem Anpfiff</h3>
            <p>
              Du bekommst die Spiele der Woche und tippst Heim, Unentschieden
              oder Auswärts. Bis zum Tippschluss änderbar.
            </p>
          </div>
          <div className="lp-card">
            <span className="lp-step">2</span>
            <h3>Während der Spiele</h3>
            <p>
              Nichts zu tun. Die Ergebnisse kommen automatisch vom offiziellen
              Ergebnisdienst herein.
            </p>
          </div>
          <div className="lp-card">
            <span className="lp-step">3</span>
            <h3>Danach</h3>
            <p>
              Die Tabelle steht sofort. Du siehst genau, wer richtig lag — und
              wer nur laut war.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ proof */}
      <Section title="Ehrlich gespielt">
        <div className="lp-grid lp-2">
          <Quote
            text="Nach dem Tippschluss ist Schluss. Kein Tipp lässt sich danach noch ändern, auch nicht von uns — das ist in der Datenbank festgeschrieben, nicht bloß versprochen."
            who="Die einzige Regel, die zählt"
          />
          <div className="lp-card">
            <h3>Jede Runde ist öffentlich</h3>
            <p style={{ marginBottom: 14 }}>
              {stats.competitions_finished > 0
                ? `${stats.competitions_finished} abgeschlossene Runde${
                    stats.competitions_finished === 1 ? "" : "n"
                  } stehen auf der Leaderboard-Seite — jede Platzierung nachlesbar, die Namen abgekürzt.`
                : "Jede abgeschlossene Runde steht auf der Leaderboard-Seite — jede Platzierung nachlesbar, die Namen abgekürzt."}
            </p>
            <a className="lp-cta lp-ghost" href="/leaderboard">
              Leaderboard ansehen
            </a>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------------- faq */}
      <Section title="Kurz gefragt">
        <div className="lp-faq">
          <details>
            <summary>Ist das eine Wette?</summary>
            <p>
              Nein. Es wird kein Einsatz angenommen und keine Quote ausgezahlt.
              Du tippst gegen andere Teilnehmer, nicht gegen einen Buchmacher.
            </p>
          </details>
          <details>
            <summary>Was kostet die Teilnahme?</summary>
            <p>Nichts. Es gibt keine Gebühr und keine Bezahlseite.</p>
          </details>
          <details>
            <summary>Muss ich mich anmelden?</summary>
            <p>
              Nein. Du startest den Bot in Telegram und bist dabei. Keine E-Mail,
              keine Telefonnummer, kein Passwort.
            </p>
          </details>
          <details>
            <summary>Wie viel Zeit kostet mich das?</summary>
            <p>
              Eine Runde tippst du in unter einer Minute. Danach musst du gar
              nichts mehr tun.
            </p>
          </details>
          <details>
            <summary>Wer kann mitmachen?</summary>
            <p>
              Alle ab 18 Jahren aus Deutschland, Österreich und der Schweiz — und
              alle anderen, die Deutsch verstehen und Telegram haben.
            </p>
          </details>
        </div>
      </Section>

      {/* ----------------------------------------------------------- closing */}
      <section className="lp-section" style={{ textAlign: "center" }}>
        <div className="lp-wrap">
          <h2 style={{ marginBottom: 10 }}>Diese Woche mitspielen</h2>
          <p className="lp-sub">
            {hasRace
              ? `Tippschluss ist ${germanWhen(competition!.locks_at)}. Wer danach kommt, ist erst nächste Woche dabei.`
              : "Die nächste Runde geht bald auf. Im Bot bekommst du Bescheid, sobald sie startet."}
          </p>
          <div className="lp-ctas">
            <Cta href={link}>⚽ Kostenlos mitspielen</Cta>
            {channel ? (
              <Cta href={channel} ghost>
                Kanal ansehen
              </Cta>
            ) : null}
          </div>
        </div>
      </section>

      <Footer />
      <div className="lp-wrap">
        <Legal />
      </div>
      <StickyCta href={link} label="⚽ Kostenlos mitspielen" />
    </div>
  );
}
