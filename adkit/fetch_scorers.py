#!/usr/bin/env python3
"""Pull the 2025/26 top-scorer lists and save the RAW provider responses.

The video is a table of numbers about real players, so not one of those numbers
is typed by hand anywhere in this kit. This script writes the provider's answer
to disk untouched; `torjaeger.py` reads that file and derives everything from
it. If a number on screen is ever wrong, it is wrong in `data/`, and that file
can be diffed against the API.

`penalty.scored` is what makes the ranking possible: goals without penalties is
`goals.total - penalty.scored`, per player, per league.

THE COMPLETENESS CHECK is the part that matters. The endpoint returns the top
20 BY TOTAL GOALS, and re-ranking by non-penalty goals can in principle pull
somebody in from outside that list. It cannot have, if the 10th place in the
new ranking has at least as many non-penalty goals as the 20th place has TOTAL
goals - because nobody outside the list can beat that total, let alone that
total minus their penalties. The script asserts it per league and refuses to
write a file it cannot prove.

Run:  API_FOOTBALL_KEY=... python3 fetch_scorers.py
"""
import json
import os
import pathlib
import sys
import urllib.request

LEAGUES = {
    78: "Bundesliga",
    39: "Premier League",
    140: "La Liga",
    135: "Serie A",
    61: "Ligue 1",
}
SEASON = 2025          # API-Football numbers a season by the year it starts.
DATA = pathlib.Path(__file__).resolve().parent / "data"


def fetch(league: int, key: str) -> dict:
    url = (f"https://v3.football.api-sports.io/players/topscorers"
           f"?league={league}&season={SEASON}")
    req = urllib.request.Request(url, headers={"x-apisports-key": key})
    with urllib.request.urlopen(req, timeout=45) as r:
        body = json.load(r)
    # API-Football answers 200 with a populated `errors` object for a bad key
    # or an exhausted quota. An outage must never become data.
    if body.get("errors"):
        raise SystemExit(f"provider error for league {league}: {body['errors']}")
    if not body.get("response"):
        raise SystemExit(f"empty response for league {league}")
    return body


def check(body: dict) -> tuple[int, int]:
    rows = []
    for p in body["response"]:
        s = p["statistics"][0]
        tot = s["goals"]["total"] or 0
        pen = s["penalty"]["scored"] or 0
        rows.append((tot - pen, tot))
    lowest_total = min(t for _, t in rows)
    rows.sort(key=lambda r: -r[0])
    return rows[9][0], lowest_total


if __name__ == "__main__":
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        raise SystemExit("API_FOOTBALL_KEY is not set")
    DATA.mkdir(exist_ok=True)
    for league, name in LEAGUES.items():
        body = fetch(league, key)
        cut, lowest = check(body)
        ok = cut >= lowest
        print(f"{name:<16} 10th non-pen = {cut:2d}   20th total = {lowest:2d}   "
              f"{'top 10 provable' if ok else 'NOT PROVABLE'}")
        if not ok:
            print("  refusing to write - the top 10 cannot be proven complete "
                  "from a top-20 list", file=sys.stderr)
            continue
        (DATA / f"topscorers-{league}-{SEASON}.json").write_text(
            json.dumps(body, ensure_ascii=False, indent=1))
    print(f"written to {DATA}")
