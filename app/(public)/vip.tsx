/**
 * The pieces /dach is built from after it became the VIP-channel page.
 *
 * That page has one job and it is not the job the rest of this route group has.
 * /moneyrace and /leaderboard sell a free prediction game with no stake; /dach
 * now sends people who saw a winning slip on Facebook into a Telegram chat
 * about betting tips. Sharing components with the other two was how the old
 * page ended up carrying a legal block that said, in bold, that no bets are
 * involved - true there, false here, and false in the one place a reader is
 * most likely to actually read.
 *
 * So: its own header (no nav), its own footer, its own legal block. The two
 * rules from ad.tsx still hold, and hold harder here -
 *
 *  1. One action. There is exactly one destination on this page. No nav, no
 *     link to the leaderboard, no "read the full analysis" under the slip. Every
 *     one of those is a way to lose a click he paid for.
 *  2. Every number is counted, not claimed. The percentages in the slips are
 *     the model's own, fetched live from the site; the fixture count is counted
 *     from the same feed. There is no win rate and no profit figure here
 *     because nothing has measured one.
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Fixture } from "@/lib/tips.ts";

/* ------------------------------------------------------------------ button */

/**
 * The button, and the only conversion signal Meta will ever get.
 *
 * The destination is t.me - off-site, in another app, on a domain no pixel of
 * his can reach. Without an event fired here, Facebook sees a click on a link
 * and nothing else, and the ad set has nothing to optimise towards but cheap
 * clicks. This fires Lead on the way out.
 *
 * It does NOT preventDefault and it does not delay navigation to wait for the
 * beacon. Meta's library already sends the event over a beacon that survives
 * the unload; holding the tap to be sure would cost real people real
 * milliseconds to protect a statistic.
 *
 * Once per page view. A second tap on the same page is the same person, and
 * counting them twice makes his cost-per-lead look better than it is - the one
 * direction of error that does not get noticed and does not get corrected.
 */
let leadSent = false;

export function VipCta({
  href,
  children,
  ghost = false,
  block = false,
}: {
  href: string;
  children: ReactNode;
  ghost?: boolean;
  block?: boolean;
}) {
  return (
    <a
      className={`lp-cta${ghost ? " lp-ghost" : ""}${block ? " vip-block" : ""}`}
      href={href}
      rel="noopener"
      onClick={() => {
        if (leadSent) return;
        leadSent = true;
        const fbq = (window as any).fbq;
        if (typeof fbq === "function") {
          fbq("track", "Lead", { content_name: "vip_telegram", content_category: "dach" });
        }
      }}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ chrome */

/** No nav. See rule 1. The mark goes nowhere on purpose. */
export function VipHeader() {
  return (
    <header className="lp-wrap lp-top vip-top">
      <span className="lp-logo lp-logo-row">
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
      </span>
      <span className="vip-flag">VIP · Telegram</span>
    </header>
  );
}

export function VipFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap">
        <p>
          TippsArena · Fußball-Analysen und Bet-Builder-Tipps für Deutschland,
          Österreich und die Schweiz. Ab 18 Jahren.
        </p>
      </div>
    </footer>
  );
}

/**
 * The legal block for a tips page.
 *
 * Not the one in ad.tsx. That block states that no bets are accepted and no
 * gambling services are offered, which is exactly right for the free MoneyRace
 * game and a plain untruth on a page about betting tips - and it is the block a
 * compliance reviewer reads first.
 *
 * Three things have to be here and each is here for its own reason: the Meta
 * disclaimer, because the ad account is the asset at risk; 18+ and the addiction
 * line, because German-language gambling advertising is expected to carry it;
 * and "no guarantee", because the page shows probabilities and a reader who
 * takes 88% for a promise is a complaint waiting to happen.
 */
export function LegalTips() {
  return (
    <div className="lp-legal">
      <p>
        <strong>Rechtlicher Hinweis.</strong> Diese Website und alle zugehörigen
        Kanäle sind vollständig unabhängig von Meta Platforms Inc. und deren
        Tochtergesellschaften. Es besteht keinerlei geschäftliche, rechtliche
        oder organisatorische Verbindung zu Meta, Facebook, Instagram oder
        verbundenen Unternehmen. Ebenso besteht keine Verbindung zu Telegram FZ-LLC.
      </p>
      <p style={{ marginTop: 8 }}>
        TippsArena veröffentlicht Analysen und Tipps zu Fußballspielen.{" "}
        <strong>Wir sind kein Wettanbieter</strong>, nehmen keine Einsätze
        entgegen und zahlen keine Gewinne aus. Alle Prozentangaben sind
        statistische Einschätzungen unseres Modells und{" "}
        <strong>keine Garantie</strong> für den Ausgang eines Spiels.
      </p>
      <p style={{ marginTop: 8 }}>
        Teilnahme ab 18 Jahren. Glücksspiel kann süchtig machen. Spiele
        verantwortungsbewusst und setze nur Geld ein, dessen Verlust du dir
        leisten kannst. Hilfe und Beratung findest du unter{" "}
        <a href="https://www.check-dein-spiel.de" rel="noopener nofollow">
          check-dein-spiel.de
        </a>{" "}
        (Deutschland), <span className="lp-nowrap">spielen-mit-verantwortung.at</span>{" "}
        (Österreich) und <span className="lp-nowrap">sos-spielsucht.ch</span> (Schweiz).
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- slip */

/** "heute 20:30 Uhr" when it is today, otherwise "Mi, 03.09. 20:30 Uhr". */
function when(date: Date, today: boolean): string {
  const p = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const clock = `${g("hour")}:${g("minute")} Uhr`;
  return today ? `heute ${clock}` : `${g("weekday")}, ${g("day")}.${g("month")}. ${clock}`;
}

/**
 * One real bet builder, drawn the way the site draws it.
 *
 * The teams are named and the kickoff is stated because a slip without them is
 * a mock-up, and this section exists precisely to prove the page is not one.
 * Nothing here is clickable - see rule 1.
 *
 * The crest images are hot-linked from api-sports, the same source the site
 * itself uses, and they carry onError → hide. A broken-image icon next to a
 * team name is worse than no crest at all, and this is the first thing on the
 * page a paid visitor looks at.
 */
export function Slip({ fixture, today }: { fixture: Fixture; today: boolean }) {
  const { combo } = fixture;
  return (
    <div className="vip-slip">
      <div className="vip-slip-head">
        <span className="vip-league">{fixture.league}</span>
        <span className="vip-when">{when(fixture.kickoff, today)}</span>
      </div>

      <div className="vip-teams">
        <span className="vip-team">
          {fixture.homeLogo ? (
            <img
              src={fixture.homeLogo}
              alt=""
              width={26}
              height={26}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          {fixture.home}
        </span>
        <span className="vip-vs">vs</span>
        <span className="vip-team">
          {fixture.awayLogo ? (
            <img
              src={fixture.awayLogo}
              alt=""
              width={26}
              height={26}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          {fixture.away}
        </span>
      </div>

      <div className="vip-combo">{combo.title}</div>

      {combo.picks.map((p, i) => (
        <div className="vip-leg" key={i}>
          <div className="vip-leg-row">
            <span>
              <b className="vip-tick">✓</b>
              {p.label}
            </span>
            {typeof p.pct === "number" ? <em>{p.pct}%</em> : null}
          </div>
          {typeof p.pct === "number" ? (
            <div className="vip-bar">
              <i style={{ width: `${Math.max(4, Math.min(100, p.pct))}%` }} />
            </div>
          ) : null}
        </div>
      ))}

      {combo.conf ? (
        <div className="vip-conf">
          Konfidenz: {combo.conf}
          {typeof combo.conf_pct === "number" ? ` ${combo.conf_pct}%` : ""}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ sticky */

/**
 * The bar that follows the thumb, once the hero button has scrolled away.
 *
 * Its own copy rather than sticky.tsx's, because the button inside it has to be
 * the VipCta - a sticky bar that navigates without firing Lead would silently
 * drop most of the conversions on a phone, which is nearly all of them.
 *
 * Hidden until the hero button is gone, same as the original: without that it
 * sits on the page from the first frame, two identical green buttons a thumb's
 * width apart, and a page that looks like a mistake does not get the tap.
 */
export function VipSticky({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lp-stick vip-stick" style={show ? undefined : { display: "none" }}>
      <VipCta href={href} block>
        {label}
      </VipCta>
    </div>
  );
}
