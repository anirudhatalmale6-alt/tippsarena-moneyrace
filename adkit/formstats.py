#!/usr/bin/env python3
"""Real numbers about a fixture, for the reasoning beat of a reel.

Everything here is derived from `data/events-{league}-{season}.json`, which is
the provider's own goal-by-goal timeline for a completed season. Nothing is
estimated and nothing is typed by hand - the whole point of the stat line is
that it is a fact a viewer could check.

THE OWN-GOAL CONVENTION IS MEASURED, NOT ASSUMED. 20 of the Bundesliga's 990
goal events last season were own goals, so getting the side wrong would have
silently corrupted 6% of the scorelines this file exists to count. I fetched
the provider's own final scores for all 306 fixtures and compared:

    crediting the event's `team` as-is  ->  306 of 306 match
    flipping own goals to the opponent ->  287 match, 19 differ

So `team` is already the team that GAINS the goal, not the team of the player
who put it in. The instinctive fix was the wrong one.

    python3 formstats.py            # rebuild and print what every pick would say
    python3 formstats.py --check    # re-verify against the provider's results
"""
from __future__ import annotations

import argparse
import collections
import functools
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
SEASON = 2025          # 2025/26, the last completed season

#: A stat is only worth saying if it is a number that helps. "This scoreline
#: happened once all season" is true and argues against the pick, so it is not
#: published - the line is dropped and the segment runs two lines instead.
MIN_SCORELINE = 12
MIN_TEAM_GAMES = 10

GOAL_DETAILS = ("Normal Goal", "Penalty", "Own Goal")


@functools.lru_cache(maxsize=None)
def season(league: int) -> list[dict] | None:
    """Every finished match of the last completed season, with its score.

    Returns None where that season was not fetched - 2. Bundesliga has no
    events file, and a promoted side has no rows in the division it just left.
    A caller that cannot tell those apart from "no goals" would publish zeroes.
    """
    path = DATA / f"events-{league}-{SEASON}.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for fx in raw["fixtures"]:
        home = fx["teams"]["home"]["id"]
        gh = ga = 0
        for e in fx["events"]:
            if e["type"] != "Goal" or e["detail"] not in GOAL_DETAILS:
                continue
            if e["team"]["id"] == home:
                gh += 1
            else:
                ga += 1
        out.append({"home": home, "away": fx["teams"]["away"]["id"],
                    "home_name": fx["teams"]["home"]["name"],
                    "away_name": fx["teams"]["away"]["name"],
                    "gh": gh, "ga": ga, "score": f"{gh}:{ga}",
                    "round": fx["round"], "date": fx["date"],
                    "events": fx["events"]})
    return out


@functools.lru_cache(maxsize=None)
def scoreline_counts(league: int) -> tuple[dict, int] | None:
    s = season(league)
    if s is None:
        return None
    return dict(collections.Counter(m["score"] for m in s)), len(s)


@functools.lru_cache(maxsize=None)
def base_rates(league: int) -> tuple[float, float]:
    """How often a side in THIS league fails to score, and how often it scores.

    Every team-game counted twice over, once per side. This is what "good"
    has to be measured against - a share that looks impressive in isolation is
    often just what everybody does.
    """
    s = season(league) or []
    sides = [m["gh"] for m in s] + [m["ga"] for m in s]
    if not sides:
        return 1.0, 1.0                    # nothing can clear an impossible bar
    blank = sum(1 for g in sides if g == 0) / len(sides)
    return blank, 1.0 - blank


def team_games(league: int, team_id: int) -> list[dict]:
    s = season(league) or []
    return [m for m in s if team_id in (m["home"], m["away"])]


def head_to_head(league: int, home_id: int, away_id: int) -> list[dict]:
    """Last season's meeting AT THIS GROUND, same way round.

    Not both legs. A set comparison would have matched the reverse fixture too,
    and "this fixture finished 3:1 last season" would then be describing a game
    in which the 3 belonged to the side that is away tonight - the sentence
    stays true-looking while meaning the opposite.
    """
    return [m for m in season(league) or []
            if m["home"] == home_id and m["away"] == away_id]


# --------------------------------------------------------------- the sentence
#: Phrasings live here and nowhere else, so LuxTipps stays English after the
#: next edit. `n` is always a real count; there is no template without one.
#: Two forms of every stat. `say` is the sentence the voice reads; `big` and
#: `label` are what the stat panel draws - a number the eye lands on and a line
#: naming it. They are separate strings on purpose: a spoken sentence rendered
#: one huge word at a time takes four seconds to say nothing, and a panel that
#: reads "GAB ES LETZTE SAISON 31 MAL IN DIESER LIGA" is a paragraph.
PHRASE = {
    "de": {
        "freq": {"say": "{score} gab es letzte Saison {n} mal in dieser Liga",
                 "big": "{n}x", "label": "{disp} LETZTE SAISON"},
        "h2h": {"say": "letzte Saison endete dieses Duell {score}",
                "big": "{disp}", "label": "LETZTES DUELL"},
        "team_scored": {"say": "{team} traf letzte Saison in {n} von {of} Spielen",
                        "big": "{n}/{of}", "label": "{team} TRAF"},
        "team_blank": {"say": "{team} blieb letzte Saison in {n} von {of} "
                              "Spielen ohne Tor",
                       "big": "{n}/{of}", "label": "{team} OHNE TOR"},
    },
    "en": {
        "freq": {"say": "{score} came up {n} times in this league last season",
                 "big": "{n}x", "label": "{disp} LAST SEASON"},
        "h2h": {"say": "this fixture finished {score} last season",
                "big": "{disp}", "label": "LAST MEETING"},
        "team_scored": {"say": "{team} scored in {n} of {of} games last season",
                        "big": "{n}/{of}", "label": "{team} SCORED"},
        "team_blank": {"say": "{team} failed to score in {n} of {of} games "
                              "last season",
                       "big": "{n}/{of}", "label": "{team} BLANKED"},
    },
}


def _fill(lang: str, key: str, **kw) -> dict:
    p = PHRASE[lang][key]
    return {"say": p["say"].format(**kw),
            "big": p["big"].format(**kw),
            "label": p["label"].format(**kw).upper()}


def candidates(league: int, fx: dict, score: str, lang: str) -> list[dict]:
    """Every true thing worth saying about this pick, strongest first.

    Ordered by how much it argues FOR the pick, not by how impressive it
    sounds. A head-to-head that already finished on this exact scoreline is
    the best line available and is rare enough to be worth checking first.
    """
    out = []
    counts = scoreline_counts(league)
    if counts is None:
        return out
    freq, total = counts

    h2h = head_to_head(league, fx["home_id"], fx["away_id"])
    if any(m["score"] == score for m in h2h):
        out.append({"kind": "h2h", "n": 1,
                    **_fill(lang, "h2h", score=_say_score(score, lang),
                            disp=score)})

    gh, ga = (int(x) for x in score.split(":"))
    for team_id, name, goals in ((fx["home_id"], fx["home_short"], gh),
                                 (fx["away_id"], fx["away_short"], ga)):
        games = team_games(league, team_id)
        if len(games) < MIN_TEAM_GAMES:
            continue                      # promoted, or a season we never held
        # Goals FOR this side, both branches. A clean sheet is about what a
        # team concedes, so quoting Genoa's clean sheets under a pick of
        # "Genoa 0" argued for the opposite of the pick while reading
        # perfectly - the sentence was true and pointed the wrong way.
        scored = [m["gh"] if m["home"] == team_id else m["ga"] for m in games]
        base_blank, base_scored = base_rates(league)
        if goals == 0:
            n = sum(1 for g in scored if g == 0)
            # Against the league's own base rate, not a flat count. "Valencia
            # failed to score in 9 of 38" is 24% where the league average is
            # 28% - a true sentence that quietly argues against the pick it is
            # there to support. A stat only earns the beat if it beats normal.
            if n / len(games) >= base_blank + 0.08:
                out.append({"kind": "blank", "n": n,
                            **_fill(lang, "team_blank", team=name, n=n,
                                    of=len(games))})
        else:
            n = sum(1 for g in scored if g > 0)
            if n / len(games) >= base_scored + 0.08:
                out.append({"kind": "scored", "n": n,
                            **_fill(lang, "team_scored", team=name, n=n,
                                    of=len(games))})

    n = freq.get(score, 0)
    if n >= MIN_SCORELINE:
        out.append({"kind": "freq", "n": n,
                    **_fill(lang, "freq", score=_say_score(score, lang),
                            n=n, disp=score)})
    return out


def _say_score(score: str, lang: str) -> str:
    """The score inside a sentence, spelled the way it is read aloud.

    "0:1" handed to the voice as digits comes back as "null Doppelpunkt eins".
    """
    import narrate as N
    return N.score_words(score, lang)


def stat_line(league: int, fx: dict, score: str, lang: str) -> dict | None:
    c = candidates(league, fx, score, lang)
    return c[0] if c else None


# --------------------------------------------------------------------- checks
def check() -> int:
    """Re-derive every scoreline and compare against the provider's results.

    This is the test that decided the own-goal question, kept so the answer
    cannot quietly rot the next time the fetcher changes.
    """
    import os
    import sys
    sys.path.insert(0, str(ROOT))
    if not os.environ.get("API_FOOTBALL_KEY"):
        print("set API_FOOTBALL_KEY to run --check")
        return 2
    from fetch_season import get
    bad = 0
    for league in (78, 39, 140, 135, 61):
        s = season(league)
        if s is None:
            print(f"{league}: no events file")
            continue
        truth = {}
        for r in get(f"fixtures?league={league}&season={SEASON}")["response"]:
            truth[(r["teams"]["home"]["id"], r["teams"]["away"]["id"],
                   r["fixture"]["date"][:10])] = (r["goals"]["home"],
                                                  r["goals"]["away"])
        ok = miss = wrong = 0
        for m in s:
            t = truth.get((m["home"], m["away"], m["date"][:10]))
            if t is None:
                miss += 1
            elif t == (m["gh"], m["ga"]):
                ok += 1
            else:
                wrong += 1
                if wrong <= 2:
                    print(f"    {m['home_name']} - {m['away_name']}: "
                          f"derived {m['score']}, provider {t[0]}:{t[1]}")
        print(f"league {league}: {ok} match, {wrong} differ, {miss} unmatched")
        bad += wrong
    print(f"\n{bad} scorelines disagree with the provider")
    return 1 if bad else 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        raise SystemExit(check())
    import glob
    for path in sorted(glob.glob(str(DATA / "tips-*.json"))):
        d = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        print(f"\n=== {d['league']}")
        for fx in d["fixtures"]:
            for brand, lang in (("tippsarena", "de"), ("luxtipps", "en")):
                if brand not in fx.get("picks", {}):
                    continue
                s = fx["picks"][brand]["score"]
                st = stat_line(d["league_id"], fx, s, lang)
                print(f"  {fx['home_short']:>12} - {fx['away_short']:<12} "
                      f"{brand:<11} {s}  "
                      + (f"[{st['big']} {st['label']}]  {st['say']}"
                         if st else "(no line worth saying)"))


if __name__ == "__main__":
    main()
