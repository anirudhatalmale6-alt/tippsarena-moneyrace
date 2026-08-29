/**
 * tippsarena.com/dach - the second Facebook landing page.
 *
 * Deliberately NOT the MoneyRace pitch. This one sells the community: the free
 * Telegram channel for Germany, Austria and Switzerland - matchday previews,
 * giveaways, results. The prize money is mentioned once, near the end, as a
 * reason to stay rather than as the hook.
 *
 * Two landing pages with two different hooks and two different campaign codes
 * means the analytics page can tell him which promise the DACH audience
 * actually clicks, instead of guessing.
 */
import type { Metadata } from "next";
import { botLink, channelLink, publicStats } from "@/lib/public.ts";
import { Footer, Header, Section, euro } from "../parts.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TippsArena — die Fußball-Community für DACH",
  description:
    "Spieltags-Previews, Tipprunden und Giveaways für Fußballfans aus "
    + "Deutschland, Österreich und der Schweiz. Kostenlos auf Telegram.",
  openGraph: {
    title: "TippsArena — die Fußball-Community für DACH",
    description:
      "Spieltags-Previews, Tipprunden und Giveaways für Fußballfans aus "
      + "Deutschland, Österreich und der Schweiz. Kostenlos auf Telegram.",
    type: "website",
    locale: "de_DE",
  },
};

export default async function DachPage() {
  const [cta, channel, stats] = await Promise.all([
    botLink("fb_dach"),
    channelLink(),
    publicStats(),
  ]);

  // The channel link if he has set one, the bot otherwise. Never a dead button.
  const primary = channel ?? cta;

  return (
    <>
      <Header active="/dach" />

      {/* ------------------------------------------------------------ hero */}
      <div className="lp-hero">
        <div className="lp-wrap">
          <span className="lp-kicker">🇩🇪 🇦🇹 🇨🇭 Kostenlos auf Telegram</span>
          <h1>
            Fußball ist besser,<br />
            wenn <em>jemand mitfiebert</em>.
          </h1>
          <p className="lp-sub">
            TippsArena ist die deutschsprachige Fußball-Community auf Telegram:
            Spieltags-Previews, Tipprunden gegen echte Gegner und regelmäßige
            Giveaways. Ohne Wettanbieter, ohne Einsatz.
          </p>
          <div className="lp-ctas">
            <a className="lp-cta" href={primary}>
              📲 KOSTENLOS BEITRETEN
            </a>
          </div>
          <p className="lp-note">
            Kein Abo · Keine Zahlungsdaten · Jederzeit mit einem Tap wieder raus
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------- what you get */}
      <Section
        title="Was dich drin erwartet"
        lead="Kein Spam, kein Dauerfeuer. Nur das, was am Spieltag zählt."
      >
        <div className="lp-grid">
          <div className="lp-card">
            <h3>⚽ Spieltags-Previews</h3>
            <p>
              Vor jedem Spieltag die Partien, auf die es ankommt — kurz,
              deutsch, auf den Punkt.
            </p>
          </div>
          <div className="lp-card">
            <h3>🎯 Tipprunden</h3>
            <p>
              Tippe die Spiele des Wochenendes gegen den Rest der Community.
              Ein Tap pro Spiel, mehr ist es nicht.
            </p>
          </div>
          <div className="lp-card">
            <h3>🎁 Giveaways</h3>
            <p>
              Immer wieder Verlosungen unter allen Mitgliedern. Zufällig
              gezogen, Gewinner öffentlich im Kanal.
            </p>
          </div>
          <div className="lp-card">
            <h3>🏆 Ranglisten</h3>
            <p>
              Wochen- und Ewigen-Wertung. Deine Punkte stehen{" "}
              <a href="/leaderboard" style={{ color: "#22c55e" }}>
                öffentlich hier
              </a>
              .
            </p>
          </div>
          <div className="lp-card">
            <h3>📊 Ergebnisse automatisch</h3>
            <p>
              Nach dem Abpfiff wird automatisch gewertet. Niemand muss etwas
              nachtragen, niemand kann etwas schönrechnen.
            </p>
          </div>
          <div className="lp-card">
            <h3>🇩🇪 Auf Deutsch</h3>
            <p>
              Bundesliga, Champions League, Europa League — für Fans aus
              Deutschland, Österreich und der Schweiz.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------- steps */}
      <Section title="So bist du dabei">
        <div className="lp-grid">
          <div className="lp-card">
            <span className="lp-step">1</span>
            <h3>Beitreten</h3>
            <p>Ein Tap öffnet TippsArena in Telegram. Kein Formular.</p>
          </div>
          <div className="lp-card">
            <span className="lp-step">2</span>
            <h3>Mitlesen</h3>
            <p>Previews und Ankündigungen kommen in den Kanal.</p>
          </div>
          <div className="lp-card">
            <span className="lp-step">3</span>
            <h3>Mitspielen</h3>
            <p>
              Bei jeder Tipprunde und jedem Giveaway kannst du mitmachen — musst
              du aber nicht.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ numbers */}
      {stats.players > 0 ? (
        <Section>
          <div className="lp-grid">
            <div className="lp-card lp-stat">
              <div className="lp-n">{stats.players}</div>
              <div className="lp-l">Mitglieder im Bot</div>
            </div>
            <div className="lp-card lp-stat">
              <div className="lp-n">{stats.competitions_finished}</div>
              <div className="lp-l">Runden gespielt</div>
            </div>
            <div className="lp-card lp-stat">
              <div className="lp-n">0 €</div>
              <div className="lp-l">Kosten für dich</div>
            </div>
          </div>
        </Section>
      ) : null}

      {/* ------------------------------------------------------- moneyrace nod */}
      <Section title="Und ja — es gibt auch was zu gewinnen">
        <div className="lp-card">
          <p style={{ color: "#93a3b4", margin: "0 0 14px" }}>
            Regelmäßig läuft in der Community die MoneyRace: dieselben Tipps,
            nur mit echtem Preisgeld für die Besten
            {stats.prize_open > 0
              ? ` — aktuell ${euro(stats.prize_open)} im Rennen.`
              : "."}{" "}
            Teilnahme bleibt kostenlos, ein Einsatz wird nie verlangt.
          </p>
          <a className="lp-cta lp-ghost" href="/moneyrace">
            MEHR ÜBER DIE MONEYRACE
          </a>
        </div>
      </Section>

      {/* -------------------------------------------------------------- faq */}
      <Section title="Kurz gefragt">
        <div className="lp-faq">
          <details>
            <summary>Kostet das etwas?</summary>
            <p>
              Nein. Kein Beitrag, kein Abo, keine Zahlungsdaten — weder für den
              Kanal noch für die Tipprunden.
            </p>
          </details>
          <details>
            <summary>Ist das Sportwetten?</summary>
            <p>
              Nein. Es gibt keinen Wettanbieter, keine Quoten und keinen
              Einsatz. Es ist ein Tippspiel unter Fans.
            </p>
          </details>
          <details>
            <summary>Wie oft kommen Nachrichten?</summary>
            <p>
              Rund um den Spieltag. Kein Dauerfeuer, und du kannst den Kanal
              jederzeit stummschalten oder verlassen.
            </p>
          </details>
          <details>
            <summary>Muss ich mitspielen?</summary>
            <p>
              Nein. Viele lesen nur mit. Bei jeder Runde entscheidest du neu.
            </p>
          </details>
        </div>
      </Section>

      <Section>
        <div className="lp-prize">
          <h2 style={{ margin: "0 0 6px" }}>Der nächste Spieltag kommt.</h2>
          <p className="lp-meta" style={{ marginBottom: 18 }}>
            Sei dabei, wenn die nächste Runde und das nächste Giveaway starten.
          </p>
          <a className="lp-cta" href={primary}>
            📲 KOSTENLOS BEITRETEN
          </a>
        </div>
      </Section>

      <Footer />
    </>
  );
}
