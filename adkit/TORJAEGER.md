# Torjäger 2025/26 — ohne Elfmeter (content videos)

Five vertical videos, one per league, ~30 s each, 1080x1920, H.264, **no audio
track** — you add trending sound in the app, same as the ad videos.

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
4. **The crown card**, only when taking penalties out changes who is top. La
   Liga is the one: Mbappé 25 with 8 penalties = 17, Muriqi 23 with 5 = 18.
5. **Close** — TippsArena MoneyRace and the bot.

## Where the numbers come from

`fetch_scorers.py` pulls the provider's answer and writes it to `data/`
**untouched**. `torjaeger.py` reads that file and derives everything on screen
from it — goal counts, clubs, names, the ranking, and which of the story cards
to show. Nothing is typed in by hand, so a wrong number on screen would be a
wrong number in `data/`, and that file can be diffed against the API.

Goals without penalties is `goals.total - penalty.scored`, per player.

### The one check that is not obvious

The provider returns the **top 20 by total goals**. Re-ranking by non-penalty
goals could in principle pull in somebody who was never in that list — a player
with 12 goals and no penalties beats a player with 14 goals and 5.

It cannot have happened here, and that is provable rather than assumed: in every
one of the five leagues, 10th place on the non-penalty list has **more**
non-penalty goals than 20th place has goals **in total**. Nobody outside the
list can beat a total they are already below.

`fetch_scorers.py` asserts this per league and refuses to write a file it cannot
prove. If a future season fails the check, the fix is a wider pull, not a
smaller claim.

## Running it

```
API_FOOTBALL_KEY=... python3 fetch_scorers.py    # refresh data/, prints the check
python3 torjaeger.py                             # all five
python3 torjaeger.py 78 140                      # Bundesliga and La Liga only
```

League ids: 78 Bundesliga · 39 Premier League · 140 La Liga · 135 Serie A ·
61 Ligue 1. Season is set by `SEASON` at the top of both files (`2025` = the
2025/26 season, the provider's numbering).

Videos land in `out/`.

## If you want a different cut

The pieces are separate functions, so these are small changes, not rewrites:
top 5 instead of top 10, a different league, one combined video across all five,
goals per 90 minutes instead of totals (the minutes are already in `data/`), or
a version with your channel's name on the close instead of the bot.
