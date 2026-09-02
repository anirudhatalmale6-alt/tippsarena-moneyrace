/**
 * tippsarena.com/dach - the VIP-channel landing page.
 *
 * REBUILT 2 Sept 2026. It used to sell the free MoneyRace tipping round, and
 * every word of that is gone: he is now running Facebook posts showing winning
 * slips, and this page is the one step between that post and his Telegram chat.
 *
 * That flow decides everything on the page.
 *
 *  * The visitor arrives having just seen a WIN. The first line has to pick up
 *    that thought mid-sentence, not introduce the brand from scratch.
 *  * The destination is a t.me chat link, not the bot. There is no deep link
 *    and therefore no ?start= campaign code, so the only conversion signal that
 *    can exist is a pixel event fired on the tap - see VipCta.
 *  * One action, everywhere. No nav, no leaderboard link, no link out to the
 *    match page under a slip. The old page had all three.
 *
 * The slips are real and live. They are fetched from the site's own REST API at
 * request time (lib/tips.ts), so the page shows the same fixtures and the same
 * percentages the site does, and it can never be caught advertising a match
 * that was played last month. If that fetch fails the section simply is not
 * rendered - a paid click must never meet an error page.
 *
 * Nothing here claims a win rate, a profit or a member count, because nothing
 * has measured one. The percentages on screen are the model's own numbers.
 */
import type { Metadata } from "next";
import { allTips, isToday, leaguesIn, slips, todayCount } from "@/lib/tips.ts";
import { Section } from "../parts.tsx";
import { Facts, Pains, Ticker } from "../ad.tsx";
import { LegalTips, Slip, VipCta, VipFooter, VipHeader, VipSticky } from "../vip.tsx";
import "../public.css";

export const dynamic = "force-dynamic";

/**
 * Where every button goes. He sent this link on 2 Sept; it is his own Telegram
 * chat, not the MoneyRace bot.
 */
const VIP_LINK = "https://t.me/m/Wi0KIlhOZDZk";

/** The word he wants people to open with, so the page and the chat agree. */
const KEYWORD = "VIP";

/**
 * The price line, or null.
 *
 * Deliberately empty. "What does it cost" is the first question a reader has
 * and I do not know the answer; a number invented here would be on his brand,
 * in his ad, long after it stopped being a line of my code. Give me the figure
 * (or "kostenlos") and it appears in the hero and in the FAQ - nothing else
 * needs to change.
 */
const PRICE: string | null = null;

export const metadata: Metadata = {
  title: "TippsArena VIP — Bet-Builder-Tipps direkt auf Telegram",
  description:
    "Die Bet-Builder-Kombis des Tages mit den Zahlen dahinter, vor dem Anpfiff auf Telegram. Für Deutschland, Österreich und die Schweiz. Ab 18.",
};

export default async function DachPage() {
  const all = await allTips();
  const { fixtures, mode } = slips(all, 2);
  const count = todayCount(all);

  // The leagues are listed rather than described, and they are read out of the
  // same feed as the slips. "Die großen europäischen Ligen" is a sentence
  // anybody can write; naming the fourteen that actually have tips in them is
  // not, and it cannot drift away from what the site is really covering.
  const leagues = leaguesIn(all);

  return (
    <div className="lp lp-ad vip">
      <Ticker
        items={[
          "Bet-Builder-Tipps",
          "Deutschland · Österreich · Schweiz",
          "Jeden Spieltag vor Anpfiff",
          "Direkt auf Telegram",
          "Ab 18 · Glücksspiel kann süchtig machen",
        ]}
      />
      <VipHeader />

      {/* ------------------------------------------------------------ hero */}
      <section className="lp-hero">
        <div className="lp-wrap">
          <div className="lp-eyebrow">VIP-Zugang · Telegram</div>
          <h1>
            Du hast den Gewinn gesehen.
            <br />
            <em>Hier kommt der nächste Tipp.</em>
          </h1>
          <p className="lp-sub">
            Bet-Builder-Kombis für die Spiele des Tages — mit den Zahlen
            dahinter. Auf dein Handy, bevor der Schiedsrichter anpfeift.
          </p>

          <div className="lp-pill">
            Kein Konto · Keine E-Mail · Ein Klick{PRICE ? ` · ${PRICE}` : ""}
          </div>

          <div className="lp-ctas">
            <VipCta href={VIP_LINK}>📲 Zum VIP-Zugang</VipCta>
          </div>
          <p className="lp-note">
            Der Knopf öffnet Telegram und du landest direkt im Chat. Schreib
            einfach „{KEYWORD}“ — alles Weitere klären wir dort.
          </p>

          <Facts
            items={[
              count > 0
                ? [`${count} Spiele`, "heute analysiert"]
                : ["Täglich", "neue Analysen"],
              ["5 Märkte", "Tore · Ecken · Karten · Schüsse · BTTS"],
              ["3 Beine", "statt einer Einzelwette"],
            ]}
          />
        </div>
      </section>

      {/* ------------------------------------------------- live proof of work */}
      {fixtures.length ? (
        <Section
          title={
            mode === "recent"
              ? "Zuletzt veröffentlicht"
              : fixtures.every(isToday)
                ? "Das läuft heute"
                : "Die nächsten Bet-Builder"
          }
          lead={
            mode === "recent"
              ? "Kein Beispielbild. Genau diese Kombis standen zuletzt auf tippsarena.com. Die für den nächsten Spieltag kommen am Vormittag."
              : "Kein Beispielbild. Genau diese Kombis stehen gerade auf tippsarena.com — und sie wechseln, sobald angepfiffen wird."
          }
        >
          <div className="vip-slips">
            {fixtures.map((f) => (
              <Slip key={f.id} fixture={f} today={mode === "upcoming" && isToday(f)} />
            ))}
          </div>
          <p className="lp-note vip-center">
            Im Kanal bekommst du sie, ohne die Seite zu öffnen.
          </p>
          <div className="lp-ctas vip-center">
            <VipCta href={VIP_LINK}>📲 Zum VIP-Zugang</VipCta>
          </div>
        </Section>
      ) : null}

      {/* ------------------------------------------------------ what you get */}
      <Section
        title="Was im Kanal passiert"
        lead="Vier Dinge, und nichts sonst."
      >
        <div className="lp-grid lp-2">
          <div className="lp-card">
            <h3>⚽ Die Kombi vor dem Anpfiff</h3>
            <p>
              Die Bet-Builder des Tages kommen zu dir, solange du noch etwas
              damit anfangen kannst. Nicht am nächsten Morgen, wenn alles schon
              gelaufen ist.
            </p>
          </div>
          <div className="lp-card">
            <h3>📊 Die Zahlen, nicht nur den Tipp</h3>
            <p>
              Zu jedem Bein die Einschätzung aus Form, Ecken, Karten und
              Torschüssen der letzten Spiele. Du siehst, worauf sie beruht, statt
              sie glauben zu müssen.
            </p>
          </div>
          <div className="lp-card">
            <h3>🎯 Drei Beine statt einer Wette</h3>
            <p>
              Doppelte Chance, Über/Unter Tore, Karten, Ecken, Torschüsse —
              kombiniert auf ein einziges Spiel. Genau das, was du auf Facebook
              gesehen hast.
            </p>
          </div>
          <div className="lp-card">
            <h3>💬 Ein Chat, kein Newsletter</h3>
            <p>
              Du kannst zurückschreiben. Fragen zu einem Spiel gehen direkt an
              uns und nicht in ein Kontaktformular.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ steps */}
      <Section title="So kommst du rein">
        <div className="lp-grid">
          <div className="lp-card">
            <span className="lp-step">1</span>
            <h3>Knopf antippen</h3>
            <p>
              Telegram öffnet sich, du stehst im Chat. Kein Konto, keine
              E-Mail-Adresse, keine Telefonnummer für uns.
            </p>
          </div>
          <div className="lp-card">
            <span className="lp-step">2</span>
            <h3>„{KEYWORD}“ schreiben</h3>
            <p>
              Ein Wort reicht. Mehr musst du nicht tippen, und ein Formular gibt
              es nicht.
            </p>
          </div>
          <div className="lp-card">
            <span className="lp-step">3</span>
            <h3>Tipps bekommen</h3>
            <p>
              Ab dann laufen die Kombis des Tages bei dir ein — an jedem Tag, an
              dem in unseren Ligen gespielt wird.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ pains */}
      <Section
        title="Für wen das gedacht ist"
        lead="Du musst kein Statistiker sein. Aber du solltest wissen wollen, warum."
      >
        <Pains
          items={[
            "Du spielst ohnehin Bet Builder und suchst die Beine nicht gern selbst zusammen.",
            "Du willst sehen, worauf eine Einschätzung beruht, statt sie einfach zu glauben.",
            "Du hast keine Lust, jeden Abend zehn Statistikseiten durchzugehen.",
            "Du willst den Tipp vor dem Anpfiff und nicht danach.",
            "Du bist über 18 und setzt nur, was du auch verlieren kannst.",
          ]}
        />
      </Section>

      {/* -------------------------------------------------------------- faq */}
      <Section title="Kurz gefragt">
        <div className="lp-faq">
          <details>
            <summary>Ist das ein Wettanbieter?</summary>
            <p>
              Nein. Wir nehmen keine Einsätze an und zahlen keine Gewinne aus.
              Wir veröffentlichen Analysen und Tipps. Wo und ob du spielst,
              bleibt vollständig deine Entscheidung.
            </p>
          </details>
          <details>
            <summary>Was bedeuten die Prozentangaben?</summary>
            <p>
              Sie sind die Einschätzung unseres Modells auf Basis der letzten
              Spiele beider Mannschaften — Form, Tore, Ecken, Karten,
              Torschüsse. Eine Einschätzung ist keine Garantie: auch 88 % gehen
              regelmäßig daneben.
            </p>
          </details>
          <details>
            <summary>Wie oft kommen Tipps?</summary>
            <p>
              An jedem Tag, an dem in unseren Ligen gespielt wird, und immer vor
              dem Anpfiff.
            </p>
          </details>
          {leagues.length ? (
            <details>
              <summary>Welche Ligen?</summary>
              <p>
                Aktuell im Programm: {leagues.join(" · ")}. Welche Spiele
                anstehen, siehst du jeden Tag im Kanal.
              </p>
            </details>
          ) : null}
          <details>
            <summary>Muss ich mich anmelden?</summary>
            <p>
              Nein. Du brauchst nur Telegram. Keine E-Mail-Adresse, kein
              Passwort, keine Registrierung auf dieser Seite.
            </p>
          </details>
          {PRICE ? (
            <details>
              <summary>Was kostet das?</summary>
              <p>{PRICE}</p>
            </details>
          ) : null}
        </div>
      </Section>

      {/* ----------------------------------------------------------- closing */}
      <section className="lp-section vip-close">
        <div className="lp-wrap">
          <h2>Der nächste Anpfiff wartet nicht.</h2>
          <p className="lp-sub">
            {mode === "upcoming" && fixtures.length
              ? `Das nächste Spiel läuft ${
                  isToday(fixtures[0]) ? "heute" : "demnächst"
                } — die Kombi dazu steht schon.`
              : "Morgen früh stehen die nächsten Kombis. Sei vorher drin."}
          </p>
          <div className="lp-ctas">
            <VipCta href={VIP_LINK}>📲 Zum VIP-Zugang</VipCta>
          </div>
          <p className="lp-note">
            Ein Klick. Danach schreibst du „{KEYWORD}“ und bist drin.
          </p>
        </div>
      </section>

      <VipFooter />
      <div className="lp-wrap">
        <LegalTips />
      </div>
      <VipSticky href={VIP_LINK} label="📲 Zum VIP-Zugang" />
    </div>
  );
}
