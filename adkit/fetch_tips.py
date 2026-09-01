#!/usr/bin/env python3
"""Pull the next matchday of six leagues and derive a scoreline for each game.

    FOOTBALL_KEY=... python3 fetch_tips.py            # all six
    FOOTBALL_KEY=... python3 fetch_tips.py 78 39      # two of them

His words: "write the most logic results that we are getting from bets api".
So the scoreline is not my opinion and it is not a model I invented - it is the
bookmakers' own EXACT SCORE market, read straight out of API-Football:

  * every bookmaker's prices for bet 10 are turned into implied probabilities
    and normalised WITHIN that bookmaker, which removes their margin. A raw
    1/odd is not a probability - the book adds up to about 1.15, and comparing
    unnormalised numbers across bookmakers silently weights the greediest one
    highest;
  * the normalised probabilities are averaged across every bookmaker that
    quotes the market, so one outlier price cannot decide a video;
  * the most likely scoreline is the tip.

When a fixture has no Exact Score market - it happens in Bundesliga 2 - the
scoreline is derived from the 1X2 and Over/Under prices through a Poisson grid
instead, and the fixture records `method: "poisson"`. That difference is worth
keeping because it is the difference between "the market says 2:1" and "the
market's goal expectation implies 2:1".

The SECOND most likely scoreline is stored too. That is what the LuxTipps videos
use: he asked for different results for the second brand, and the honest way to
be different is to publish the market's next-best line, not a number I made up.

Season is NOT passed to /fixtures. Today is in 2026/27 and API-Football's
`season=2025` is 2025/26, which is over - asking for it returns zero rows and
looks exactly like a broken key.
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import sys
import time
import urllib.request
from collections import Counter, defaultdict

KEY = os.environ.get("FOOTBALL_KEY", "8505b37317b50b765f881172a0345318")
BASE = "https://v3.football.api-sports.io"
ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
IMG = DATA / "img" / "teams"

LEAGUES = {
    39: ("premier-league", "Premier League", "England"),
    78: ("bundesliga", "Bundesliga", "Deutschland"),
    79: ("bundesliga-2", "2. Bundesliga", "Deutschland"),
    140: ("la-liga", "La Liga", "Spanien"),
    135: ("serie-a", "Serie A", "Italien"),
    61: ("ligue-1", "Ligue 1", "Frankreich"),
}

# Names as a fan writes them on a graphic. Anything not here is used verbatim -
# never invent a nickname for a club.
SHORT = {
    "Manchester City": "Man City", "Manchester United": "Man United",
    "Nottingham Forest": "Nottm Forest", "Tottenham": "Tottenham",
    "Wolverhampton Wanderers": "Wolves", "Brighton": "Brighton",
    "Newcastle": "Newcastle", "West Ham": "West Ham", "Leeds": "Leeds",
    "Borussia Mönchengladbach": "Gladbach", "Borussia Dortmund": "Dortmund",
    "Bayer Leverkusen": "Leverkusen", "1899 Hoffenheim": "Hoffenheim",
    "SC Paderborn 07": "Paderborn", "SV Elversberg": "Elversberg",
    "Werder Bremen": "Bremen", "RB Leipzig": "Leipzig", "SC Freiburg": "Freiburg",
    "Eintracht Frankfurt": "Frankfurt", "Bayern München": "Bayern",
    "VfB Stuttgart": "Stuttgart", "VfL Wolfsburg": "Wolfsburg",
    "FSV Mainz 05": "Mainz 05", "1. FC Köln": "Köln", "FC Augsburg": "Augsburg",
    "FC St. Pauli": "St. Pauli", "Hamburger SV": "HSV",
    "1. FC Heidenheim": "Heidenheim", "FC Schalke 04": "Schalke",
    "Arminia Bielefeld": "Bielefeld", "Hannover 96": "Hannover",
    "Karlsruher SC": "Karlsruhe", "Holstein Kiel": "Kiel",
    "1. FC Nürnberg": "Nürnberg", "1. FC Kaiserslautern": "Kaiserslautern",
    "SV Darmstadt 98": "Darmstadt", "Energie Cottbus": "Cottbus",
    "Dynamo Dresden": "Dresden", "VfL Bochum": "Bochum",
    "SpVgg Greuther Fürth": "Fürth", "Hertha BSC": "Hertha",
    "1. FC Magdeburg": "Magdeburg", "VfL Osnabrück": "Osnabrück",
    "Eintracht Braunschweig": "Braunschweig",
    "Atletico Madrid": "Atlético", "Athletic Club": "Athletic",
    "Real Sociedad": "Sociedad", "Deportivo La Coruna": "Depor",
    "Racing Santander": "Racing", "Rayo Vallecano": "Rayo",
    "Celta Vigo": "Celta", "Real Madrid": "Real Madrid",
    "Paris Saint Germain": "PSG", "Stade Brestois 29": "Brest",
    "Estac Troyes": "Troyes", "Paris FC": "Paris FC", "Le Mans": "Le Mans",
    "AS Roma": "Roma", "AC Milan": "Milan", "Inter": "Inter",
}


def get(path: str, **params) -> dict:
    url = f"{BASE}/{path}?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url, headers={"x-apisports-key": KEY})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                d = json.loads(r.read())
            break
        except Exception as e:                       # noqa: BLE001
            if attempt == 3:
                raise
            print(f"    retry {attempt + 1} ({e})")
            time.sleep(2 + attempt * 3)
    # A bad key or an exhausted quota comes back as HTTP 200 with a populated
    # `errors` object. Treating that as "no data" is how an outage turns into
    # a video full of nothing.
    errs = d.get("errors")
    if errs:
        if isinstance(errs, dict) and "rateLimit" in errs:
            # Per-MINUTE limit. Waiting it out is right; aborting halfway
            # through a league leaves a half-written matchday on disk.
            print("    rate limited, waiting 65s")
            time.sleep(65)
            return get(path, **params)
        raise SystemExit(f"api error on {path}: {errs}")
    return d


# ------------------------------------------------------------------ scorelines
def _parse_score(v: str) -> tuple[int, int] | None:
    s = str(v).replace("-", ":").strip()
    if ":" not in s:
        return None
    a, _, b = s.partition(":")
    try:
        return int(a), int(b)
    except ValueError:
        return None


def from_exact_market(bookmakers: list) -> dict[tuple[int, int], float] | None:
    """Average normalised implied probability per scoreline, across books."""
    per_book: list[dict] = []
    for bk in bookmakers:
        for bet in bk.get("bets", []):
            if bet.get("id") != 10:
                continue
            probs = {}
            for v in bet.get("values", []):
                sc = _parse_score(v.get("value"))
                try:
                    odd = float(v.get("odd"))
                except (TypeError, ValueError):
                    continue
                if sc and odd > 1.0:
                    probs[sc] = probs.get(sc, 0.0) + 1.0 / odd
            # A book that quotes only a handful of lines cannot be normalised
            # meaningfully - its total is nowhere near 1 and normalising it
            # would invent confidence it never expressed.
            if len(probs) >= 12 and sum(probs.values()) > 0.85:
                tot = sum(probs.values())
                per_book.append({k: v / tot for k, v in probs.items()})
    if not per_book:
        return None
    out: dict[tuple[int, int], float] = defaultdict(float)
    for p in per_book:
        for k, v in p.items():
            out[k] += v / len(per_book)
    return dict(out)


def from_poisson(bookmakers: list) -> dict[tuple[int, int], float] | None:
    """Fallback: 1X2 plus Over/Under 2.5 -> two goal expectations -> a grid.

    Independent Poisson understates draws, which is why this is the fallback and
    not the method. It is only reached when nobody prices the exact score.
    """
    p1x2, ou = [], []
    for bk in bookmakers:
        for bet in bk.get("bets", []):
            vals = {str(v.get("value")): v.get("odd") for v in bet.get("values", [])}
            if bet.get("id") == 1 and {"Home", "Draw", "Away"} <= vals.keys():
                try:
                    raw = [1 / float(vals[k]) for k in ("Home", "Draw", "Away")]
                except (TypeError, ValueError, ZeroDivisionError):
                    continue
                t = sum(raw)
                p1x2.append([x / t for x in raw])
            if bet.get("id") == 5 and {"Over 2.5", "Under 2.5"} <= vals.keys():
                try:
                    o, u = 1 / float(vals["Over 2.5"]), 1 / float(vals["Under 2.5"])
                except (TypeError, ValueError, ZeroDivisionError):
                    continue
                ou.append(o / (o + u))
    if not p1x2:
        return None
    ph, pd, pa = (sum(c) / len(p1x2) for c in zip(*p1x2))
    p_over = sum(ou) / len(ou) if ou else 0.52

    # Total goals from P(over 2.5); solved by bisection because there is no
    # closed form for the Poisson tail.
    def over25(lmb: float) -> float:
        return 1 - math.exp(-lmb) * (1 + lmb + lmb ** 2 / 2)

    lo, hi = 0.4, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if over25(mid) < p_over:
            lo = mid
        else:
            hi = mid
    total = (lo + hi) / 2
    # Split it by the 1X2 balance. The 0.42 exponent is a shape constant, not a
    # fitted parameter: it just has to move the split in the right direction.
    ratio = ((ph + pd / 2) / max(1e-6, pa + pd / 2)) ** 0.42
    lam_h = total * ratio / (1 + ratio)
    lam_a = total - lam_h

    def pois(k: int, lmb: float) -> float:
        return math.exp(-lmb) * lmb ** k / math.factorial(k)

    return {(h, a): pois(h, lam_h) * pois(a, lam_a)
            for h in range(7) for a in range(7)}


def outcome(sc: tuple[int, int]) -> str:
    return "H" if sc[0] > sc[1] else ("A" if sc[1] > sc[0] else "D")


# ----------------------------------------------------------------------- crests
def crest(url: str, team_id: int) -> str | None:
    IMG.mkdir(parents=True, exist_ok=True)
    dest = IMG / f"{team_id}.png"
    if dest.exists() and dest.stat().st_size > 400:
        return dest.name
    try:
        with urllib.request.urlopen(url, timeout=40) as r:
            dest.write_bytes(r.read())
        return dest.name
    except Exception as e:                          # noqa: BLE001
        print(f"    crest {team_id} failed: {e}")
        return None


# ------------------------------------------------------------------------- main
def matchday(league: int) -> tuple[str, list]:
    """The next matchday, chosen by WHICH ROUND HAS THE MOST GAMES.

    Taking the round of the earliest upcoming fixture is wrong: La Liga has a
    single rearranged Round 6 game sitting in front of the whole of Round 4, and
    that would have produced a one-match video.
    """
    d = get("fixtures", league=league, next=20)
    rounds = Counter(f["league"]["round"] for f in d["response"])
    best = max(rounds, key=lambda r: (rounds[r], -min(
        f["fixture"]["timestamp"] for f in d["response"] if f["league"]["round"] == r)))
    games = sorted((f for f in d["response"] if f["league"]["round"] == best),
                   key=lambda f: f["fixture"]["timestamp"])
    return best, games


def main() -> None:
    wanted = [int(a) for a in sys.argv[1:]] or list(LEAGUES)
    DATA.mkdir(parents=True, exist_ok=True)
    for lid in wanted:
        slug, name, country = LEAGUES[lid]
        rnd, games = matchday(lid)
        print(f"=== {name}: {rnd}, {len(games)} games")
        out = {"league_id": lid, "slug": slug, "league": name, "country": country,
               "round": rnd, "round_size": len(games), "no_market": [],
               "fixtures": []}
        for f in games:
            fid = f["fixture"]["id"]
            time.sleep(0.45)
            odds = get("odds", fixture=fid)
            books = odds["response"][0]["bookmakers"] if odds["response"] else []
            grid = from_exact_market(books)
            method = "exact_score_market"
            if grid is None:
                grid = from_poisson(books)
                method = "poisson_from_1x2_ou"
            if grid is None:
                pair = (f"{f['teams']['home']['name']} - "
                        f"{f['teams']['away']['name']}")
                out["no_market"].append(pair)
                print(f"    !! {pair} - no pre-match market published, skipped")
                continue
            ranked = sorted(grid.items(), key=lambda kv: -kv[1])
            top, second = ranked[0], ranked[1]
            h, a = f["teams"]["home"], f["teams"]["away"]
            out["fixtures"].append({
                "id": fid,
                "kickoff": f["fixture"]["date"],
                "home": h["name"], "away": a["name"],
                "home_short": SHORT.get(h["name"], h["name"]),
                "away_short": SHORT.get(a["name"], a["name"]),
                "home_id": h["id"], "away_id": a["id"],
                "home_crest": crest(h["logo"], h["id"]),
                "away_crest": crest(a["logo"], a["id"]),
                "method": method,
                "books": len(books),
                "tip": {"home": top[0][0], "away": top[0][1],
                        "p": round(top[1], 4), "outcome": outcome(top[0])},
                "alt": {"home": second[0][0], "away": second[0][1],
                        "p": round(second[1], 4), "outcome": outcome(second[0])},
                "top5": [{"score": f"{s[0]}:{s[1]}", "p": round(p, 4)}
                         for s, p in ranked[:5]],
            })
            t = out["fixtures"][-1]
            print(f"    {t['home_short']:<16} {t['tip']['home']}:{t['tip']['away']}"
                  f"  {t['away_short']:<16} p={t['tip']['p']:.3f}"
                  f"  alt {t['alt']['home']}:{t['alt']['away']}  [{method}]")
        path = DATA / f"tips-{lid}.json"
        path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"    -> {path.name}  ({len(out['fixtures'])} fixtures)")


if __name__ == "__main__":
    main()
