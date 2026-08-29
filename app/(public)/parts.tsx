/** Pieces shared by the three public pages. */
import type { ReactNode } from "react";

export function Header({ active }: { active?: string }) {
  const link = (href: string, label: string) => (
    <a key={href} href={href} style={active === href ? { color: "#eaf1f8" } : undefined}>
      {label}
    </a>
  );
  return (
    <header className="lp-wrap lp-top">
      <a className="lp-logo lp-logo-row" href="/moneyrace">
        {/* His mark, not a generic wordmark. eager + explicit size so it never
            reflows the header while the page is being read. */}
        <img
          className="lp-mark"
          src="/brand/mark-white.png"
          alt=""
          width={34}
          height={34}
          loading="eager"
        />
        <span className="lp-word">
          TIPPS<span>ARENA</span>
        </span>
      </a>
      <nav>
        {link("/moneyrace", "MoneyRace")}
        {link("/leaderboard", "Leaderboard")}
        {link("/dach", "Community")}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap">
        <p>
          TippsArena · Kostenlose Fußball-Tipprunden auf Telegram. Kein Einsatz,
          keine Wette, kein Glücksspiel. Ab 18 Jahren.
        </p>
        <p style={{ marginTop: 8 }}>
          <a href="/moneyrace">MoneyRace</a> ·{" "}
          <a href="/leaderboard">Leaderboard</a> ·{" "}
          <a href="/dach">Community</a>
        </p>
      </div>
    </footer>
  );
}

/** German money, the way the rest of the platform writes it. */
export function euro(amount: number | string, currency = "EUR"): string {
  const value = Number(amount ?? 0);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

/** A date a German reader can act on: "Sa, 29.08. um 15:25 Uhr". */
export function germanWhen(value: Date | string | null): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("day")}.${get("month")}. um ${get("hour")}:${get("minute")} Uhr`;
}

export function Section({
  children,
  title,
  lead,
}: {
  children: ReactNode;
  title?: string;
  lead?: string;
}) {
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        {title ? <h2>{title}</h2> : null}
        {lead ? <p className="lp-lead">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}
