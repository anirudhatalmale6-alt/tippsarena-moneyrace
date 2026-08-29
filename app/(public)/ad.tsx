/**
 * The pieces both paid-traffic pages are built from.
 *
 * Two rules run through all of it:
 *
 *  1. One action. Every button on the page is the same button - open the bot.
 *     A second offer competing for the same thumb is a second way to lose it.
 *  2. Every number is counted, not claimed. The prize, the deadline and the
 *     player count come out of the same tables the dashboard reads. There is no
 *     "87% win rate" here because nobody has measured one, and an invented
 *     figure on his brand is his problem long after it is my line of code.
 */
import type { ReactNode } from "react";

export function Ticker({ items }: { items: string[] }) {
  const run = (
    <>
      {items.map((text, i) => (
        <span key={i}>◆ {text}</span>
      ))}
    </>
  );
  return (
    <div className="lp-ticker" aria-hidden="true">
      {/* Twice, so the loop from -50% lands exactly where it started. */}
      <div>
        {run}
        {run}
      </div>
    </div>
  );
}

export function Cta({
  href,
  children,
  ghost = false,
}: {
  href: string;
  children: ReactNode;
  ghost?: boolean;
}) {
  return (
    <a
      className={`lp-cta${ghost ? " lp-ghost" : ""}`}
      href={href}
      rel="noopener"
    >
      {children}
    </a>
  );
}

export function Pains({ items }: { items: string[] }) {
  return (
    <ul className="lp-pains">
      {items.map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  );
}

export function Quote({ text, who }: { text: string; who: string }) {
  return (
    <div className="lp-quote">
      <p>„{text}“</p>
      <cite>{who}</cite>
    </div>
  );
}

/**
 * The legal block.
 *
 * Not decoration: a page that sells against Meta's ad policies without stating
 * its independence, its 18+ limit and that no gambling is offered is a page
 * that gets the ad account restricted. It is small, but it is readable and it
 * is on the page rather than behind a link.
 */
export function Legal() {
  return (
    <div className="lp-legal">
      <p>
        <strong>Rechtlicher Hinweis.</strong> Diese Website und alle zugehörigen
        Kanäle sind vollständig unabhängig von Meta Platforms Inc. und deren
        Tochtergesellschaften. Es besteht keinerlei geschäftliche, rechtliche
        oder organisatorische Verbindung zu Meta, Facebook, Instagram oder
        verbundenen Unternehmen.
      </p>
      <p style={{ marginTop: 8 }}>
        TippsArena ist ein kostenloses Tippspiel. Es wird <strong>kein Einsatz</strong>{" "}
        verlangt, es werden <strong>keine Wetten</strong> angenommen und es
        werden keine Glücksspiel- oder Wettdienstleistungen angeboten. Die
        Teilnahme ist gratis und ohne Kaufverpflichtung. Der Rechtsweg ist
        ausgeschlossen. Teilnahme ab 18 Jahren.
      </p>
    </div>
  );
}
