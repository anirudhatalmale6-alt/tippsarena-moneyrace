#!/usr/bin/env python3
"""Check the goal-by-goal data against the provider's own season totals.

Two independent paths through the same provider have to arrive at the same
number for every player: counting individual `Goal` events out of every
fixture, and reading `goals.total - penalty.scored` off `players/topscorers`.
They are computed by different endpoints from different tables, so agreement
is real evidence and disagreement means the video would be wrong.

This is the check that would have caught the `Missed Penalty` trap on its own:
counting missed penalties as goals puts the event tally ABOVE the season total
for exactly the players who missed one.

It also confirms the thing the video quietly depends on - that the players it
puts on screen have clean names available, because the event list's names are
not reliable.

Run:  SEASON=2024 python3 verify_events.py
"""
import json
import os
import pathlib
import sys

DATA = pathlib.Path(__file__).resolve().parent / "data"
SEASON = int(os.environ.get("SEASON", "2024"))
ROWS = int(os.environ.get("ROWS", "8"))
LEAGUES = {78: "Bundesliga", 39: "Premier League", 140: "La Liga",
           135: "Serie A", 61: "Ligue 1"}


def check(league: int) -> bool:
    ev_path = DATA / f"events-{league}-{SEASON}.json"
    ts_path = DATA / f"topscorers-{league}-{SEASON}.json"
    if not ev_path.exists() or not ts_path.exists():
        print(f"{LEAGUES[league]:<16} SKIPPED - missing data file")
        return False
    ev = json.loads(ev_path.read_text())
    ts = json.loads(ts_path.read_text())

    open_play: dict[int, int] = {}
    pens: dict[int, int] = {}
    rounds: set[int] = set()
    for fx in ev["fixtures"]:
        rounds.add(fx["round"])
        for e in fx["events"]:
            if e["type"] != "Goal":
                continue
            pid = e["player"]["id"]
            if pid is None:
                continue
            if e["detail"] == "Normal Goal":
                open_play[pid] = open_play.get(pid, 0) + 1
            elif e["detail"] == "Penalty":
                pens[pid] = pens.get(pid, 0) + 1

    bad = []
    for p in ts["response"]:
        pid = p["player"]["id"]
        s = p["statistics"][0]
        tot = s["goals"]["total"] or 0
        pen = s["penalty"]["scored"] or 0
        if (tot - pen, pen) != (open_play.get(pid, 0), pens.get(pid, 0)):
            bad.append((p["player"]["name"], tot - pen, open_play.get(pid, 0),
                        pen, pens.get(pid, 0)))

    # Every matchday must be present, or a Spieltag in the middle of the video
    # would silently be a matchday on which nobody in the league scored.
    missing = sorted(set(range(1, ev["matchdays"] + 1)) - rounds)

    # The cast the video will show must all have clean names.
    names = {p["player"]["id"] for p in ts["response"]}
    cast = sorted(open_play, key=lambda p: -open_play[p])[:ROWS]
    nameless = [p for p in cast if p not in names]

    ok = not bad and not missing and not nameless
    print(f"{LEAGUES[league]:<16} {len(ts['response']):2d} players cross-checked, "
          f"{ev['matchdays']} matchdays, "
          f"{'ALL AGREE' if ok else 'PROBLEM'}")
    for name, a, b, c, d in bad:
        print(f"    MISMATCH {name}: totals say {a} npg / {c} pen, "
              f"events say {b} npg / {d} pen")
    if missing:
        print(f"    matchdays with no fixtures at all: {missing}")
    for pid in nameless:
        print(f"    player {pid} is in the top {ROWS} but has no clean name")
    return ok


if __name__ == "__main__":
    wanted = [int(a) for a in sys.argv[1:]] or list(LEAGUES)
    results = [check(lg) for lg in wanted]
    print(f"\n{sum(results)}/{len(results)} leagues verified")
    sys.exit(0 if all(results) else 1)
