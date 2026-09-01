/**
 * tippsarena.com/moneyrace - the paid-traffic page for the prize money.
 *
 * One promise, one number, one button. The number is the prize actually sitting
 * on the open competition and the deadline is its real lock time, both read
 * from the database at request time, so the page cannot advertise a race that
 * closed yesterday.
 *
 * Campaign code fb_moneyrace: every click arrives at the bot carrying it, and
 * the Analytics page groups by it, so he can tell this page apart from /dach
 * without a tracking pixel.
 */
import type { Metadata } from "next";
import {
  botLink, campaignCode, channelLink, competitionFixtures, nextCompetition,
  publicStats,
} from "@/lib/public.ts";
import { Footer, Header, Section, euro, germanWhen } from "../parts.tsx";
import { Countdown } from "../countdown.tsx";
import { Cta, Facts, Legal, Mark, Pains, Preview, Quote, Ticker } from "../ad.tsx";
import { StickyCta } from "../sticky.tsx";
import "../public.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TippsArena MoneyRace — Tippe Bundesliga, gewinne echtes Geld",
  description:
    "Kostenlos mittippen und echtes Preisgeld gewinnen. Kein Einsatz, keine Wette, keine Anmeldung. Läuft komplett in Telegram.",
};

export default async function MoneyRacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const competition = await nextCompetition();
  const stats = await publicStats();
  // ?c=fb_mr_preisgeld etc. One page, one code per creative, so the Analytics
  // page can say which hook produced the people who actually started the bot.
  // No parameter at all still reports as fb_moneyrace exactly as before.
  const link = await botLink(campaignCode((await searchParams).c, "fb_moneyrace"));
  const channel = await channelLink();
  const fixtures = competition ? await competitionFixtures(competition.id) : [];
  const needsChannel = Boolean(competition?.requires_membership);

  const prize = competition
    ? euro(competition.prize_amount, competition.currency)
    : euro(stats.prize_open || 0);
  const hasRace = Boolean(competition?.locks_at);

  // The bot preview, built from the round that is actually open. It used to be
  // four hand-written bubbles naming a fixture from August; an ad quoting this
  // weekend's prize and then showing last month's match reads as a mock-up.
  const previewLines: Array<[string, boolean]> = [
    [`🏁 <b>${competition?.name ?? "Bundesliga MoneyRace"}</b><br/>💰 Preisgeld: <b>${prize}</b>` +
      (hasRace ? `<br/>🔒 Tippschluss: ${germanWhen(competition!.locks_at)}` : ""), false],
  ];
  if (needsChannel) {
    // The channel step is real when requires_membership is on. Leaving it out
    // does not remove it, it just moves the surprise to after the click.
    previewLines.push(["📣 Tritt dem Kanal bei, dann geht es los.", false]);
    previewLines.push(["Beigetreten", true]);
  }
  if (fixtures.length) {
    const f = fixtures[0];
    const left = fixtures.length - 1;
    previewLines.push([`⚽ <b>${f.home_team} — ${f.away_team}</b><br/>Wer gewinnt?`, false]);
    previewLines.push([`🔴 ${f.home_team}`, true]);
    previewLines.push([`✅ Gespeichert. Noch ${left} ${left === 1 ? "Spiel." : "Spiele."}`, false]);
  } else {
    previewLines.push(["⚽ Die Spiele der Runde erscheinen hier.", false]);
  }

  return (
    <div className="lp lp-ad">
      <Ticker
        items={[
          "100 % kostenlos",
          "Kein Einsatz",
          "Keine Wette",
          "Echtes Preisgeld",
          "Läuft in Telegram",
          "In 30 Sekunden dabei",
        ]}
      />
      <Header active="/moneyrace" />

      {/* ------------------------------------------------------------ hero */}
      <section className="lp-hero">
        <div className="lp-wrap">
          <Mark />
          <div className="lp-eyebrow">TippsArena MoneyRace</div>
          <h1>
            Tippe die Bundesliga.
            <br />
            Gewinn <em>echtes Geld</em>.
          </h1>
          <p className="lp-sub">
            Kein Einsatz. Keine Wette. Keine Anmeldung. Du tippst, wer gewinnt —
            und wer am meisten richtig hat, bekommt das Preisgeld ausgezahlt.
          </p>

          <div className="lp-pot">
            <div className="lp-flag">Gratis dabei</div>
            <div className="lp-for">Aktuelles Preisgeld</div>
            <div className="lp-amount">{prize}</div>
            {competition ? (
              <>
                <div className="lp-meta" style={{ marginTop: 10 }}>
                  {competition.name}
                </div>
                {hasRace ? (
                  <>
                    <Countdown target={new Date(competition.locks_at!).toISOString()} />
                    <div className="lp-note">
                      Tippschluss: {germanWhen(competition.locks_at)}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="lp-meta" style={{ marginTop: 10 }}>
                Die nächste Runde startet in Kürze — sei im Bot, wenn sie aufgeht.
              </div>
            )}
          </div>

          <div className="lp-ctas" style={{ marginTop: 26 }}>
            <Cta href={link}>
              {hasRace ? "🏁 Jetzt kostenlos mittippen" : "🏁 Kostenlos dabei sein"}
            </Cta>
          </div>
          <p className="lp-note">
            {needsChannel
              ? "Ein Klick. Telegram öffnet sich, du trittst dem Kanal bei und tippst sofort los. Kein Konto, keine E-Mail, keine Kreditkarte."
              : "Ein Klick. Telegram öffnet sich. Kein Konto, keine E-Mail, keine Kreditkarte."}
          </p>

          <Facts
            items={[
              [prize, "Preisgeld"],
              ["0 €", "Einsatz"],
              ["< 1 Min", "Zeitaufwand"],
            ]}
          />
        </div>
      </section>

      {/* -------------------------------------------------- what it looks like */}
      <Section
        title="So sieht es im Bot aus"
        lead="Kein Formular, keine Anmeldung. Ein Chat, drei Knöpfe."
      >
        <Preview lines={previewLines} />
      </Section>

      {/* ------------------------------------------------------- three steps */}
      <Section title="In 30 Sekunden dabei">
        <div className="lp-grid">
          <div className="lp-card">
            <span className="lp-step">1</span>
            <h3>Bot öffnen</h3>
            <p>
              {needsChannel
                ? "Ein Klick auf den Button. Telegram startet den TippsArena-Bot — du trittst dem Kanal bei und bist drin."
                : "Ein Klick auf den Button. Telegram startet den TippsArena-Bot — mehr passiert nicht."}
            </p>
          </div>
          <div className="lp-card">
            <span className="lp-step">2</span>
            <h3>Tippen</h3>
            <p>
              Heim, Unentschieden oder Auswärts. Ein Spiel nach dem anderen, mit
              einem Daumen, in unter einer Minute.
            </p>
          </div>
          <div className="lp-card">
            <span className="lp-step">3</span>
            <h3>Gewinnen</h3>
            <p>
              Die Ergebnisse kommen automatisch rein. Wer am meisten richtig hat,
              bekommt das Preisgeld.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ pains */}
      <Section
        title="Warum TippsArena?"
        lead="Weil du beim Tippen nichts verlieren kannst, was dir gehört."
      >
        <Pains
          items={[
            "Du zahlst nichts ein. Es gibt keinen Einsatz und nichts zu verlieren.",
            "Es ist keine Wettannahme — du spielst gegen die anderen Tipper, nicht gegen einen Buchmacher.",
            "Kein Konto, keine E-Mail, keine Kreditkarte. Telegram reicht.",
            "Du brauchst keine Ahnung von Quoten oder Statistik. Nur eine Meinung, wer gewinnt.",
            "Eine Runde dauert weniger als eine Minute — auch neben der Arbeit.",
            "Die Ergebnisse kommen direkt vom offiziellen Ergebnisdienst. Niemand rechnet hier von Hand.",
          ]}
        />
      </Section>

      {/* ------------------------------------------------------------ proof */}
      <Section title="Fair und nachvollziehbar">
        <div className="lp-grid lp-2">
          <Quote
            text="Jede Runde hat einen festen Tippschluss. Danach kann kein Tipp mehr geändert werden — auch nicht von uns. Die Ergebnisse kommen automatisch vom Ergebnisdienst, und die Tabelle rechnet sich selbst."
            who="So funktioniert TippsArena"
          />
          <div className="lp-card">
            <h3>Die Tabelle ist öffentlich</h3>
            <p style={{ marginBottom: 14 }}>
              Jede Runde und jede Platzierung steht auf der Leaderboard-Seite —
              mit abgekürzten Namen, damit niemand öffentlich bloßgestellt wird.
            </p>
            <a className="lp-cta lp-ghost" href="/leaderboard">
              Leaderboard ansehen
            </a>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------------- faq */}
      <Section title="Häufige Fragen">
        <div className="lp-faq">
          <details>
            <summary>Kostet das wirklich nichts?</summary>
            <p>
              Nein. Es gibt keinen Einsatz, keine Gebühr und keine Bezahlseite.
              Du tippst kostenlos mit und kannst gewinnen.
            </p>
          </details>
          <details>
            <summary>Ist das eine Sportwette?</summary>
            <p>
              Nein. Es wird kein Einsatz angenommen und keine Quote ausgezahlt.
              Du tippst gegen die anderen Teilnehmer; wer am meisten richtig
              liegt, bekommt das Preisgeld.
            </p>
          </details>
          <details>
            <summary>Wie bekomme ich das Geld?</summary>
            <p>
              Der Gewinner wird direkt im Bot benachrichtigt und meldet sich bei
              uns. Die Auszahlung wird persönlich abgewickelt.
            </p>
          </details>
          <details>
            <summary>Kann ich meine Tipps ändern?</summary>
            <p>
              Ja, bis zum Tippschluss so oft du willst. Danach ist die Runde
              gesperrt — für alle gleichzeitig, ohne Ausnahme.
            </p>
          </details>
          <details>
            <summary>Brauche ich Telegram?</summary>
            <p>
              Ja. Telegram ist kostenlos und in zwei Minuten installiert. Danach
              läuft alles darin — es gibt nichts weiter zu installieren.
            </p>
          </details>
        </div>
      </Section>

      {/* ----------------------------------------------------------- closing */}
      <section className="lp-section" style={{ textAlign: "center" }}>
        <div className="lp-wrap">
          <h2 style={{ marginBottom: 10 }}>
            {hasRace ? `${prize} liegen bereit.` : "Sei bei der nächsten Runde dabei."}
          </h2>
          <p className="lp-sub">
            {hasRace
              ? `Tippschluss ist ${germanWhen(competition!.locks_at)}. Danach geht nichts mehr.`
              : "Wir sagen dir im Bot Bescheid, sobald die nächste Runde aufgeht."}
          </p>
          <div className="lp-ctas">
            <Cta href={link}>🏁 Jetzt kostenlos mittippen</Cta>
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
      <StickyCta href={link} label="🏁 Jetzt kostenlos mittippen" />
    </div>
  );
}
