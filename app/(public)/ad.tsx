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

/** The mark, leading the hero. */
export function Mark({ size = 116 }: { size?: number }) {
  return (
    <img
      className="lp-mark"
      src="/brand/mark-white.png"
      alt="TippsArena"
      width={size}
      height={size}
      style={{ width: size }}
      loading="eager"
    />
  );
}

/**
 * Three counted facts under the button.
 *
 * Every one comes from the database. The site he sent as a reference puts an
 * "87% WIN RATE" here; his says how much money is actually on the table, which
 * is both true and checkable.
 */
export function Facts({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="lp-facts">
      {items.map(([value, label]) => (
        <div key={label}>
          <b>{value}</b>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}

/**
 * What the bot looks like, drawn in CSS.
 *
 * People do not click into a Telegram bot they cannot picture. A real
 * screenshot would be truer but it is another request in front of the fold, and
 * these pages are paid-for phone traffic.
 */
export function Preview({ lines }: { lines: Array<[string, boolean]> }) {
  return (
    <div className="lp-phone">
      {lines.map(([text, mine], i) => (
        <div
          className={`lp-bubble${mine ? " lp-me" : ""}`}
          key={i}
          dangerouslySetInnerHTML={{ __html: text }}
        />
      ))}
    </div>
  );
}
