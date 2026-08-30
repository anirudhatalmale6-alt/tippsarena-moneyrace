#!/usr/bin/env python3
"""Pull every goal of a league season, matchday by matchday, and save it RAW.

`players/topscorers` gives season totals and nothing else, so it cannot answer
"who was top after Spieltag 9". A bar race needs the goals in the order they
happened, and the only place that exists is the event list of each individual
fixture. So this fetches the fixture list, then the events of every fixture,
and writes the provider's answers untouched. `torrace.py` derives every number
on screen from that file.

THE TRAP, and it is not a small one: API-Football gives a MISSED penalty
`type: "Goal"` with `detail: "Missed Penalty"`. Counting "Goal" events would
credit a player a goal he did not score - the very first fixture fetched here
has one (Wirtz, Gladbach-Leverkusen, 90'). Own goals are also `type: "Goal"`
and belong to nobody's tally. Only `Normal Goal` and `Penalty` are goals, and
only `Normal Goal` counts for this video.

Player NAMES in the event list are dirty - the same fixture returns
`"1                         F. Wirtz"` for a player whose id is perfectly
correct. Everything here keys on the numeric player id; the display name comes
from `topscorers-*.json`, which is clean.

Run:  SEASON=2024 API_FOOTBALL_KEY=... python3 fetch_season.py 78
"""
import concurrent.futures as cf
import json
import os
import pathlib
import sys
import threading
import time
import urllib.request

LEAGUES = {
    78: "Bundesliga",
    39: "Premier League",
    140: "La Liga",
    135: "Serie A",
    61: "Ligue 1",
}
SEASON = int(os.environ.get("SEASON", "2024"))
DATA = pathlib.Path(__file__).resolve().parent / "data"
KEY = os.environ.get("API_FOOTBALL_KEY", "")


# The plan allows 300 requests per MINUTE (and 7500 per day). A season is ~350
# requests, so the day is never the problem and the minute always is. One lock
# and a minimum gap between starts is enough, and is far more predictable than
# backing off after the provider has already refused.
RATE_PER_MIN = 240
_gate = threading.Lock()
_last = [0.0]


def _wait_turn() -> None:
    gap = 60.0 / RATE_PER_MIN
    with _gate:
        now = time.monotonic()
        due = max(now, _last[0] + gap)
        _last[0] = due
    if due > now:
        time.sleep(due - now)


def get(path: str, tries: int = 6) -> dict:
    url = "https://v3.football.api-sports.io/" + path
    req = urllib.request.Request(url, headers={"x-apisports-key": KEY})
    for attempt in range(tries):
        _wait_turn()
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = json.load(r)
        except Exception:                             # noqa: BLE001
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
            continue
        # A 200 with a populated `errors` object is how this provider reports a
        # bad key, an exhausted quota, or the per-minute limit. An outage must
        # never become data - but the rate limit is worth waiting out, because
        # dying here throws away every fixture already fetched.
        errors = body.get("errors")
        if errors:
            if isinstance(errors, dict) and "rateLimit" in errors:
                time.sleep(20)
                continue
            raise SystemExit(f"provider error on {path}: {errors}")
        return body
    raise SystemExit(f"gave up on {path} - still rate limited after {tries}")


def fetch_league(league: int) -> dict:
    fx = get(f"fixtures?league={league}&season={SEASON}")
    fixtures = fx["response"]

    # Only finished matches of the league phase. A season with a relegation
    # play-off tacked on ("Relegation Round") is not part of the matchday count
    # and would appear as a 35th Spieltag that most of the league did not play.
    keep = [f for f in fixtures
            if f["fixture"]["status"]["short"] in ("FT", "AET", "PEN")
            and f["league"]["round"].startswith("Regular Season - ")]
    if not keep:
        raise SystemExit(f"no finished regular-season fixtures for {league}")

    rounds = sorted({int(f["league"]["round"].rsplit(" - ", 1)[1]) for f in keep})
    if rounds != list(range(1, len(rounds) + 1)):
        raise SystemExit(f"league {league}: matchdays are not 1..N: {rounds}")

    print(f"  {LEAGUES[league]}: {len(keep)} fixtures over {len(rounds)} "
          f"matchdays, fetching events", flush=True)

    def one(f):
        fid = f["fixture"]["id"]
        ev = get(f"fixtures/events?fixture={fid}")
        return {
            "fixture_id": fid,
            "round": int(f["league"]["round"].rsplit(" - ", 1)[1]),
            "date": f["fixture"]["date"],
            "teams": {
                "home": {"id": f["teams"]["home"]["id"],
                         "name": f["teams"]["home"]["name"]},
                "away": {"id": f["teams"]["away"]["id"],
                         "name": f["teams"]["away"]["name"]},
            },
            "events": ev["response"],
        }

    out = []
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        for i, row in enumerate(pool.map(one, keep), 1):
            out.append(row)
            if i % 50 == 0:
                print(f"    {i}/{len(keep)}", flush=True)

    out.sort(key=lambda r: (r["round"], r["date"], r["fixture_id"]))

    # A fixture whose events came back empty is indistinguishable from a 0-0
    # here, so count them and say how many. Silence is what turns a gap in the
    # data into a wrong number on screen.
    empty = sum(1 for r in out if not r["events"])
    goals = sum(1 for r in out for e in r["events"]
                if e["type"] == "Goal" and e["detail"] == "Normal Goal")
    pens = sum(1 for r in out for e in r["events"]
               if e["type"] == "Goal" and e["detail"] == "Penalty")
    missed = sum(1 for r in out for e in r["events"]
                 if e["type"] == "Goal" and e["detail"] == "Missed Penalty")
    own = sum(1 for r in out for e in r["events"]
              if e["type"] == "Goal" and e["detail"] == "Own Goal")
    print(f"    {goals} open-play goals, {pens} penalties scored, "
          f"{own} own goals, {missed} penalties MISSED (not goals), "
          f"{empty} fixtures with no events at all", flush=True)

    return {
        "league": league,
        "league_name": LEAGUES[league],
        "season": SEASON,
        "matchdays": len(rounds),
        "fixtures": out,
    }


if __name__ == "__main__":
    if not KEY:
        raise SystemExit("API_FOOTBALL_KEY is not set")
    wanted = [int(a) for a in sys.argv[1:]] or list(LEAGUES)
    DATA.mkdir(exist_ok=True)
    for league in wanted:
        print(f"{LEAGUES[league]} {SEASON}", flush=True)
        body = fetch_league(league)
        path = DATA / f"events-{league}-{SEASON}.json"
        path.write_text(json.dumps(body, ensure_ascii=False))
        print(f"  -> {path} ({path.stat().st_size // 1024} KB)", flush=True)
