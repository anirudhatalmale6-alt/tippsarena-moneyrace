# Poster set and prediction videos (1 Sept 2026)

Two deliverables, one shared drawing module.

## `poster.py`
Primitives only: the procedural night stadium, the horizontal type squeeze
(there is no condensed display face installed, so Lato Black Italic is drawn and
compressed), drop shadows, the Telegram disc, the medal discs, the brand disc.
`brand_disc()` pastes `mark.png` — the **black** silhouette, which is the one
that belongs on orange. `mark-white.png` is a different logo, not a fallback.

Nothing here reads data. Nothing here decides copy.

## `posters.py` — 30 image creatives
5 messages × 3 placements × 2 accents.

```
python3 posters.py                 # everything
python3 posters.py champion        # one motif, all ratios and accents
```

* Every figure comes from `campaign.py`, which reads the live competition.
  Nothing is typed. That is the fix for the 29 August videos, which carried
  `PRIZE = "149,97 €"` as a literal and would have advertised a prize the bot
  does not pay.
* Each ratio is **composed**, not cropped. A 1:1 cut out of a 9:16 loses its
  headline, and the headline is the only part of an ad that has to survive.
* `Stack.render()` measures every block first, then spreads the slack across the
  **gaps**. Growing the type instead is how a headline ends up larger than the
  offer. If a stack still does not fit, `build()` **raises** — the first Platz-1
  sheet ran 120 px off the top of the 4:5 canvas and sliced the logo in half, and
  it took a contact sheet to notice. Silent overflow looks fine in code.
* The 1:1 drops the eyebrow and the subline and the ranking panel drops to two
  podium rows. Three squeezed rows and a squeezed CTA is worse than two clear
  ones.
* **The ranking panel shows an empty podium.** His reference creative shows
  47 / 43 / 39 points and "49. DU"; the database has 5 users, 2 participants and
  no finished competition. Invented numbers in a paid ad are the one claim a
  screenshot can disprove.
* His reference also names `@TIPPSARENA_MONEYRACE_BOT`. That bot does not exist.
  The handle is read from `campaign.json`.

## `fetch_tips.py` — where the scorelines come from
His words: *"the most logic results that we are getting from bets api"*.

1. `/fixtures?league=L&next=20`, grouped by round. **The matchday is the round
   with the most games**, not the round of the earliest fixture — La Liga has a
   single rearranged Round 6 game sitting in front of all of Round 4, and that
   would have produced a one-match video.
2. `/odds?fixture=F`, bet **id 10, Exact Score**. Every price → implied
   probability → **normalised within that bookmaker**, which removes the margin.
   A raw `1/odd` is not a probability; a book sums to ≈1.15, and comparing
   unnormalised numbers across books silently weights the greediest one highest.
   A book quoting fewer than 12 lines is skipped — it cannot be normalised
   meaningfully.
3. Averaged across every book that quotes the market, then ranked.
   `tip` = most likely, `alt` = second most likely.

No season parameter on `/fixtures`. Today is in 2026/27; API-Football's
`season=2025` is 2025/26, which is finished, and asking for it returns zero rows
that look exactly like a broken key.

`rateLimit` in the `errors` object is retried after 65 s, not treated as fatal —
aborting halfway leaves a half-written matchday on disk. Every other `errors`
value is fatal, because an outage answering HTTP 200 must never become data.

Fixtures with no pre-match market at all are recorded in `no_market`, not just
printed. Seven of them on 1 Sept; the delivery note has to be able to name them.

## `tips_video.py` — 12 videos
```
python3 tips_video.py                        # both brands, six leagues
python3 tips_video.py --brand luxtipps 140
```

* **TippsArena publishes `tip`, LuxTipps publishes `alt`.** He asked for
  different scorelines for the second brand; the honest way to differ is the
  market's next-best line, not a number picked to be different.
* Header says **PROGNOSE**, never FULL TIME. His reference account posts results;
  these run before kick-off, and a viewer who reads a prediction as a result
  concludes the account lies the moment the real score lands.
* Frames are piped to ffmpeg as **raw RGB on stdin**. 1200 PNGs per video would
  be 1.5 GB on disk and slower than the drawing.
* Only ~20 frames per match segment are actually drawn; the rest are copies of
  two cached stills (`pre` before the reveal, `post` after). That is what makes
  a 40-second video render in 20 seconds.
* Crest tiles are white — a crest on a dark background is unreadable for half the
  clubs in Europe.
* LuxTipps is black/gold from his own avatar plus a diagonal hairline texture, so
  the two sets are told apart by more than hue.

## Verification
`ffprobe` per file: `audio_streams=0`, 1080×1920, 30/1, frame count matching
duration. Frames pulled back **out of the encoded mp4** with `ffmpeg -ss` and
checked against `tips-<league>.json` — Betis–Real Madrid renders 1:2 for
TippsArena and 0:2 for LuxTipps, which is exactly `tip` and `alt`.
