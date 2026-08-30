# Torjäger — ohne Elfmeter (content videos)

Five vertical videos per season, one per league, ~30 s each, 1080x1920, H.264,
**no audio track** — you add trending sound in the app, same as the ad videos.

Two seasons are built: **2025/26** (running) and **2024/25** (finished). The
season is a switch, not a copy of the script — see "Running it".

The text on screen is German because that is what a player reads. This file is
English because that is what you read.

## What the video says

1. **Hook** — the league's official top scorer, and how many of his goals came
   from the penalty spot. If he took none, the hook says that instead; Serie A
   gets "17 Tore. Kein einziger Elfmeter."
2. **The top 10 without penalties**, revealed a row at a time. Every row shows
   where its number came from: `36 Tore · 10 Elfmeter`.
3. **Who owes the most to the spot** — the three biggest penalty tallies in the
   league, each with `total → without penalties`.
4. **The crown card**, only when taking penalties out changes who is top. It is
   computed per league per season, not chosen by me: in 2025/26 only La Liga
   qualifies, in 2024/25 it is the Bundesliga (Kane 26 with 9 penalties = 17,
   Schick 21 with 1 = 20) and Ligue 1 (Greenwood 22 with 7 = 15, Dembélé 20).
5. **Close** — TippsArena MoneyRace and the bot.

The card order in the timeline is hook → table → crown (if any) → penalties →
source → close, so a league without a crown change is simply shorter. Nothing
has to be edited to render a season whose story is different.

## Where the numbers come from

`fetch_scorers.py` pulls the provider's answer and writes it to `data/`
**untouched**. `torjaeger.py` reads that file and derives everything on screen
from it — goal counts, clubs, names, the ranking, and which of the story cards
to show. Nothing is typed in by hand, so a wrong number on screen would be a
wrong number in `data/`, and that file can be diffed against the API.

Goals without penalties is `goals.total - penalty.scored`, per player.

### The check that was not enough — read this before trusting a number here

The provider returns the **top 20 by total goals**. Re-ranking by non-penalty
goals could in principle pull in somebody who was never in that list — a player
with 12 goals and no penalties beats a player with 14 goals and 5.

`fetch_scorers.py` proves that cannot have happened by checking that 10th place
on the non-penalty list has more non-penalty goals than 20th place has goals in
total. Nobody outside the list can beat a total they are already below.

**The reasoning is valid and the conclusion was still wrong**, because it is a
proof about the list and the list was itself missing people. Ferran Torres
scored 10 non-penalty goals in La Liga 2024/25 and is not in the top 20 at all.
Two more faults in the same source were found the same way (see `TORRACE.md`):
`statistics[0]` is only one club, so a January transfer is half-counted, and
Lewandowski's and Greenwood's season totals are each off by one against their
own goals.

So `load()` now counts individual goal events from
`data/events-<league>-<season>.json` whenever that file exists, and only falls
back to the season totals when it does not — printing a warning when it does.
Run `fetch_season.py` and `verify_events.py` before rendering a season.

## Running it

```
API_FOOTBALL_KEY=... python3 fetch_scorers.py               # refresh data/, prints the check
python3 torjaeger.py                                        # all five, running season
python3 torjaeger.py 78 140                                 # Bundesliga and La Liga only

SEASON=2024 API_FOOTBALL_KEY=... python3 fetch_scorers.py   # a different season
SEASON=2024 python3 torjaeger.py
```

League ids: 78 Bundesliga · 39 Premier League · 140 La Liga · 135 Serie A ·
61 Ligue 1.

`SEASON` is the year the season **starts**, which is the provider's own
numbering: `2025` = 2025/26, `2024` = 2024/25. The on-screen label is derived
from it, so a season cannot be captioned as a different one. Fetch before you
render — the completeness check above belongs to the fetch, and rendering a
season nobody proved would be the one way to get a wrong table on screen.

A finished season is captioned **"Endtabelle 2024/25"**; the running one is
**"Saisonstatistik 2025/26"**. Saying "Stand today" about a table that stopped
moving in May would claim it was still live.

Videos land in `out/`.

## If you want a different cut

The pieces are separate functions, so these are small changes, not rewrites:
top 5 instead of top 10, a different league, one combined video across all five,
goals per 90 minutes instead of totals (the minutes are already in `data/`), or
a version with your channel's name on the close instead of the bot.
