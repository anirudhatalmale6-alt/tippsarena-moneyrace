/**
 * The bet builder tips that tippsarena.com is publishing right now.
 *
 * The /dach landing page shows real fixtures with real percentages, and this is
 * where they come from: the WordPress REST API of his own site, the same
 * `ta_markets` / `ta_matchinfo` post meta the match pages render from. Nothing
 * on the landing page is written by hand, so the page and the site can never
 * disagree, and an ad that runs for three weeks never shows an August fixture.
 *
 * Both meta keys are already registered as public on the WP side - checked, not
 * assumed - so this needs no plugin, no key and no write access anywhere.
 *
 * Failure is silent BY DESIGN. This is paid traffic: if WordPress is slow, down
 * or mid-deploy, the landing page must still render its hook and its button.
 * Every error path here returns an empty list and the section disappears; it
 * must never turn a click he paid for into a 500.
 */

const ENDPOINT = "https://tippsarena.com/wp-json/wp/v2/posts";
const FIELDS = "id,link,meta.ta_markets,meta.ta_matchinfo";

/** A leg of a combo: what to bet, and the model's probability for it. */
export interface Pick {
  label: string;
  pct?: number | null;
}

export interface Combo {
  title: string;
  picks: Pick[];
  conf: string;
  conf_pct: number | null;
}

export interface Fixture {
  id: number;
  url: string;
  home: string;
  away: string;
  league: string;
  homeLogo: string | null;
  awayLogo: string | null;
  kickoff: Date;
  combo: Combo;
}

/**
 * Correct-score combos are dropped.
 *
 * "Ergebnis-Prognose" is a single exact scoreline, which is a different product
 * with a different hit rate, and he has said plainly that these pages and the
 * reels are for bet builders. It also renders as one lonely row where every
 * other card has three.
 */
const SKIP = /Ergebnis-Prognose/i;

/** The combo to lead with: most legs first, then highest confidence. */
function best(combos: Combo[]): Combo | null {
  const usable = combos.filter(
    (c) => c && !SKIP.test(c.title) && Array.isArray(c.picks) && c.picks.length >= 2,
  );
  if (!usable.length) return null;
  usable.sort(
    (a, b) => b.picks.length - a.picks.length || (b.conf_pct ?? 0) - (a.conf_pct ?? 0),
  );
  return usable[0];
}

function parse(row: any): Fixture | null {
  try {
    const mk = JSON.parse(row?.meta?.ta_markets || "null");
    const mi = JSON.parse(row?.meta?.ta_matchinfo || "null");
    if (!mk || !mi || !mi.kickoff || !mi.home || !mi.away) return null;
    const combo = best(mk.betbuilder || []);
    if (!combo) return null;
    const kickoff = new Date(mi.kickoff);
    if (Number.isNaN(kickoff.getTime())) return null;
    return {
      id: row.id,
      url: row.link,
      home: mi.home,
      away: mi.away,
      league: mi.league || "",
      homeLogo: mi.home_logo || null,
      awayLogo: mi.away_logo || null,
      kickoff,
      combo,
    };
  } catch {
    return null;
  }
}

/**
 * Everything the site has published that parses, in KICKOFF order.
 *
 * Kickoff order, not publish order. The posts go up in one batch the morning
 * before, so publish order says nothing about which match is next, and an ad
 * promising "tonight" that leads with a 15:30 game already played reads as a
 * dead page.
 *
 * Revalidates every 10 minutes: often enough that a finished match drops off
 * quickly, rarely enough that a burst of ad clicks hammers WordPress.
 */
export async function allTips(): Promise<Fixture[]> {
  try {
    const res = await fetch(`${ENDPOINT}?per_page=60&_fields=${FIELDS}`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows
      .map(parse)
      .filter((f): f is Fixture => f !== null)
      .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  } catch {
    return [];
  }
}

/** Those that have not kicked off yet. */
export function upcoming(all: Fixture[], limit = 2): Fixture[] {
  const now = Date.now();
  return all.filter((f) => f.kickoff.getTime() > now).slice(0, limit);
}

/**
 * What to put in the proof section, and how to label it.
 *
 * Measured on the live feed at 21:24 on 2 Sept: the last kickoff of the day was
 * 20:45 and the next day's posts do not exist yet, so `upcoming` was empty and
 * the section vanished. The ads do not stop at 21:00. Between the last whistle
 * and the next morning's batch, roughly a third of every day, the page would
 * have lost the only block on it that proves there is a model behind the ad.
 *
 * So it falls back to the most recently published fixtures, and says so. Their
 * kickoff is printed as a date rather than "heute", and nothing claims they are
 * still open - they are shown as work published, which is what they are. What
 * it does NOT do is show a result, won or lost: a landing page that displays
 * only the winners is a track record nobody counted.
 */
export function slips(all: Fixture[], limit = 2): {
  fixtures: Fixture[];
  mode: "upcoming" | "recent";
} {
  const next = upcoming(all, limit);
  if (next.length) return { fixtures: next, mode: "upcoming" };
  return { fixtures: all.slice(-limit).reverse(), mode: "recent" };
}

/** The leagues that appear in the feed, commonest first. */
export function leaguesIn(all: Fixture[]): string[] {
  const n = new Map<string, number>();
  for (const f of all) {
    if (f.league) n.set(f.league, (n.get(f.league) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const berlinDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/**
 * How many fixtures the site has analysed for today, in Berlin time.
 *
 * Counted, not claimed - it is the one number on the page that says how much
 * work is behind it, so it has to be true on the day it is read.
 */
export function todayCount(all: Fixture[]): number {
  const today = berlinDay(new Date());
  return all.filter((f) => berlinDay(f.kickoff) === today).length;
}

/** True when the fixture kicks off today in Berlin - "heute 20:30" vs a date. */
export function isToday(f: Fixture): boolean {
  return berlinDay(f.kickoff) === berlinDay(new Date());
}
