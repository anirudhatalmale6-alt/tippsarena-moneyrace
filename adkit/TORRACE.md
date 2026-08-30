# Torjäger ohne Elfmeter — the bar race

Five vertical videos, one per league, 31–35 s, 1080x1920, H.264, **no audio
track** — you add trending sound in the app.

Built to match the reference post you sent: the season ghosted behind the
title, an orange pill for the league and an outlined one for OHNE ELFMETER, a
Spieltag counter, and bars that grow and overtake each other week by week with
the club crest, the player's photo riding the end of his bar, and a badge for
what he did that matchday.

The text on screen is German because that is what a viewer reads. This file is
English because that is what you read.

## The cast

The eight rows are the season's **final** top eight without penalties, tracked
from Spieltag 1 — which is why players sit on 0 at the start, exactly as in
your reference. Showing "whoever leads today" instead would swap the whole cast
every week and be unreadable.

`ROWS=6` or `ROWS=10` changes it.

## Where the numbers come from

`data/events-<league>-<season>.json` — **every goal event of every fixture of
the season**, saved exactly as the provider returned it. A goal counts only if
it is `type: "Goal"` with `detail: "Normal Goal"`.

Three things arrive as `type: "Goal"` and are not that:

* `Penalty` — a scored penalty, which is the whole point of the video
* `Own Goal` — a goal, but not the scorer's
* `Missed Penalty` — **not a goal at all**, and there are 108 of them across
  the five leagues in 2024/25. Counting `type: "Goal"` naively credits Wirtz an
  extra goal against Gladbach on matchday 1.

## Why not the season-totals endpoint

The first version of these videos used `players/topscorers`, which gives each
player's season totals. Counting the goals individually let the two be compared,
and they disagree. Every disagreement was the aggregate being wrong:

* **`statistics[0]` is one club.** A player who transfers in January has half a
  season counted. For Gouiri the provider returned *two identical* 10-goal
  blocks; his real figure is 13, three for Rennes and ten for Marseille.
* **Lewandowski** came back as 26 goals when he won the Pichichi with 27;
  **Greenwood** as 22 when the goals say 21.
* **The top-20-by-total list is not complete.** Ferran Torres scored 10
  non-penalty goals in La Liga and is not in it.

That last one matters beyond the numbers. `fetch_scorers.py` proves the
re-ranked top 10 is complete by checking that 10th place on non-penalty goals
beats 20th place on total goals. The reasoning is valid and the conclusion was
still unsafe, because it is a proof *about the list* and the list was missing
somebody. Counting individual goals has no list to fall off the end of.

`torjaeger.py` now reads the event data too whenever it is present, and says so
loudly when it has to fall back.

## Verifying it

```
SEASON=2024 python3 verify_events.py
```

Counts every goal out of the fixtures and compares it against the provider's
own season totals, player by player, and checks that no matchday is missing and
that every player the video will name has a clean name available. It exits
non-zero on any disagreement. **A disagreement is not automatically the events
being wrong** — investigate it; so far it has always been the aggregate.

Names come from `topscorers-*.json` because the event list's are dirty: the
same fixture returns `"1                         F. Wirtz"` for a player whose
id is perfectly correct. Everything is keyed on the numeric player id.

## Two rules in the animation that are not decoration

* **A tie keeps the order it already had.** Ranking each matchday from scratch
  and breaking ties by name made Burkardt jump above Kleindienst the moment he
  drew *level* with him, which on screen is indistinguishable from an overtake.
  A row now only moves when somebody actually goes past somebody.
* **Rows are drawn worst-first**, so during a swap the player moving up is
  painted over the one he passes, and the bars carry a shadow. Without both,
  the few frames where two rows overlap are an unreadable block.

Club colours are sampled from each crest rather than typed into a table of ~98
values I would have to be right about. A crest with no colour in it at all —
Mönchengladbach's is pure black, white and grey at the size the provider serves
— falls through to `CLUB_COLOUR_OVERRIDE` and prints a warning. The neutral
fallback is deliberately *not* the brand orange, so a miss can never look like
a decision.

## Running it

```
SEASON=2024 API_FOOTBALL_KEY=... python3 fetch_season.py 78   # ~310 requests
SEASON=2024 python3 verify_events.py 78
SEASON=2024 python3 torrace.py 78
```

League ids: 78 Bundesliga · 39 Premier League · 140 La Liga · 135 Serie A ·
61 Ligue 1. No argument means all five.

`SEASON` is the year the season **starts** — the provider's own numbering, so
`2024` is 2024/25. The plan allows 300 requests a minute and 7500 a day; a
season is ~310 requests, so the fetcher paces itself at 240/min and waits out a
rate limit rather than dying and throwing away what it has.

Videos land in `out/`.

## If you want a different cut

`ROWS` for the row count; `MOVE` and `HOLD` at the top of `torrace.py` for the
pace (currently 0.46 s of travel and 0.30 s of rest per matchday); a different
season is `SEASON=`; a different league is an argument.
