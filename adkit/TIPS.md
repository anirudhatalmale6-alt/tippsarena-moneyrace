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
3. Averaged across every book that quotes the market, then ranked. The
   AVERAGE QUOTED PRICE is kept alongside the probability - he prices creative
   in odds, and a fair `1/p` has the margin stripped out, so it is not a number
   anybody can bet.
4. `assign()` then chooses what each brand publishes. **Not the favourite.**
   His correction: *"you picked always the lowest odd ... we know most of these
   won't end like this and it's not interesting to watch"*. He is right - the
   most likely exact score is an 8-12% shot, so publishing it weekly is a column
   of near-identical 1:2s that is no more accurate than the line beside it. So:
   only lines priced 5.00-20.00, target zone rotating short/middle/long down the
   matchday, least-used scoreline first, and the two brands can never land on the
   same score for one fixture. Depth is capped at the 12 likeliest lines - inside
   a 5-20 band a 4:3 can technically qualify in a wide-open game.

   A repeat inside one video is possible and legitimate: on the LuxTipps Premier
   League sheet the only unused line left for Arsenal-Chelsea was 2:0, which
   TippsArena had already taken for that same fixture. Verified as forced, not
   as a tie-break accident.

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

* **Both brands publish a real quoted line**, chosen by `assign()` above. The
  price itself is **not on screen** - he asked for it off both brands. It still
  governs the selection; it is simply not published.
* **Kick-off times are local, not UTC.** They were raw UTC, which is the hour he
  read as wrong. `TZ` renders the true local hour rather than a fixed offset, so
  it stays right after 25 October. He first said "+1", then confirmed what he
  actually wanted: *"Set them to the German local time zone at the moment."*
  Europe/Berlin is that clock in both halves of the year.
* **Nothing is written in the footer of either brand.** First the two CTA lines
  went, then the handle with them: *"i don't need @tippsarenamoneyrace_Bot on it
  or luxtippsbot"*. The dark brand grew its frame into the space; the light brand
  keeps the band as a shape so the cream does not run off the screen.
* **No title card.** *"the tips should start rightaway"* - frame one is the first
  fixture. The "Quotenmarkt 5.00 bis 20.00" line he objected to lived on that
  card and went with it.
* **All copy comes from `STRINGS[lang]`.** LuxTipps is `en`, TippsArena is `de`,
  and no draw call contains a literal word. That is what keeps "LuxTipps in
  English" true after the next edit to a shared layout - including the weekday
  and date format, which is `SAT 6 SEP` there and `SA 06.09.` here.
* **LuxTipps is rebuilt, not recoloured** - "completely different design so no
  one can say hm this is actually same site". Cream instead of black, dark bands
  top and bottom, a two-row scorecard read top-to-bottom instead of a
  side-by-side, round badges instead of white squares, and the score arrives as
  two numbers landing on two teams rather than one number in the middle.
  The badge core is CREAM, not charcoal: measured against a charcoal disc,
  Liverpool, Nottingham Forest and HSV have almost no ink bright enough to read,
  and Liverpool is in the flagship video.
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

## `narrate.py` + `_tts_worker.py` — the spoken cut
*"can you also add voiceovers or you can't do that at your end?"* — yes, and
without an account of his: **piper**, a neural TTS that runs offline on this
machine. `de_DE-thorsten-high` reads TippsArena, `en_GB-northern_english_male`
reads LuxTipps. No API key, no per-video cost, nothing sent anywhere.
`install_voices.sh` rebuilds the venv and the two models; neither is in the
repo (~180 MB of binary that never changes).

* **The voice sets the cut, not the grid.** A silent segment is 3.6 s;
  "Borussia Moenchengladbach gegen Eintracht Frankfurt. Unser Tipp: drei zu
  zwei." does not fit in it. Each fixture's segment is stretched to hold its own
  two lines and only the still already on screen is held longer — so the
  narrated Bundesliga cut runs 42.6 s against 32.4 s silent. Speeding the read
  up to fit a fixed grid is the alternative, and it sounds like it.
* **The tip is never spoken before it is shown.** The score appears at REVEAL;
  the second line starts at REVEAL + 0.12 s, or after the team line if that is
  still running. Never earlier.
* **Offsets are computed in frames, not seconds.** Rounding each segment up to
  a whole frame and then accumulating seconds would drift up to a third of a
  second over ten matches — enough to put a word before its picture.
* Piper is a VITS model, so its duration predictor is **stochastic**: the same
  sentence is a few frames longer each time it is synthesized. The plan that was
  actually muxed is therefore written to a manifest beside the wav, and the
  verifier reads that. Recomputing it describes a track that never existed —
  which is exactly how the first check reported a 4-frame mismatch that was its
  own fault.
* **Every tip line is listened to before it is used.** The German voice slurs
  "null" into something like "Müll" about one line in fifty - one of them
  shipped, in the La Liga set, and only a transcript caught it. It is a
  lottery, not a phrasing problem: over 48 samples a colon before the score
  scored 48/48 and a comma 47/48, so my first theory (punctuation) was noise.
  `narrate.confirm()` transcribes each tip and asks piper for another take
  until the digits are audible, then refuses rather than shipping. Tested both
  ways - a true claim passes with no retake, a false one retries and then
  raises; a guard that never fires proves nothing.
* Club names are spoken from a small `SAY` map where the on-screen short name
  would be read wrong: PSG, HSV, "Mainz 05", "Nottm Forest", "Man United". The
  German voice gets `oe`/`ue` spellings, which it reads correctly.
* The narrated files carry a `-voice` suffix. The silent set is untouched — this
  is an option, not a replacement, and nothing moved out of the picture into the
  audio.

## `reel.py` — the short-form cut (2 Sept)
*"What about this kind of videos? Can you create something similar?"* — five
screenshots of **billhpicks**: broadcast footage running behind, one enormous
green word at a time landing on the beat, a small dark card naming the pick.

```
python3 reel.py 78 --picks 3            # both brands
python3 reel.py 39 --brand luxtipps --bg stadium
```

* **The captions are word-synced to the voice, not eyeballed.** This is the
  whole reason it needed `narrate.py` first. The line is synthesized, the wav
  is run back through whisper with word timestamps, and each caption is placed
  on its own word. Change a scoreline and the cut re-times itself.
* **Whisper supplies the timing only.** What is drawn is my script text aligned
  onto the transcript with a sequence diff — a mis-heard club name must never
  reach the screen in 190pt letters. Words whisper drops are interpolated
  between the two it did hear.
* **A caption token is not a word.** "2:1" is one token on screen and three
  words in the mouth ("zwei zu eins"), so display text and spoken text are
  carried separately all the way into the manifest.
* **The card shows the score 0.10 s before the voice says it**, never after —
  same rule as the long cut, in the other direction.
* **The footage is deliberately not broadcast.** His references run World Cup
  and La Liga clips; that is the part of this format that gets an account with
  a paying product behind it struck rather than throttled. `fetch_broll.sh`
  pulls Coverr and Mixkit clips (free for commercial use, no attribution), and
  `--bg stadium` uses the procedural stadium and touches no third-party frame
  at all. His own licensed clips are a file drop plus one list entry.
* The two brands do not share the caption colour or the crest treatment.
  TippsArena uses its own orange rather than the green the whole niche uses,
  and a white disc with an orange rim; LuxTipps keeps its cream-and-gold badge.

## `check_names.py` — does the voice actually say the club?
The SAY map in `narrate.py` was a list of guesses, and one of them was wrong
for a fortnight: the English entries were keyed `"Koln"` while the flattener
produces `"Koeln"`, so the lookup never fired and LuxTipps read the German
spelling out loud. The key is now the accent-STRIPPED form, so `Köln`, `Koeln`
and `Koln` all land on the same entry.

Every club in the six leagues is now synthesized inside the real sentence
template and transcribed back, **twice** — once as the map says it, once as it
is plainly written. A respelling is kept only where it measures more
recognisable than the plain spelling; the ones that did not are reported as
"no better than plain" and were removed. Whisper is not a listener, but a name
it cannot recover from clean studio audio is a name a viewer will not recover
either.

## Verification
`ffprobe` per file: `audio_streams=0`, 1080×1920, 30/1, frame count matching
duration. Then a frame is pulled back **out of the encoded mp4** with
`ffmpeg -ss` at the moment a chosen fixture's score is on screen, and diffed
against the frame the code draws for that same fixture — mean abs error 1.6-1.8
across all twelve, which is h.264 loss and nothing else. Reading the JSON and
trusting the render would not have caught a mis-ordered segment or a wrong
brand binding.

`verify_voice.py` does the same job for the narrated cut, by **listening**: the
audio is pulled back out of the mp4 and transcribed with whisper, then every
scoreline is checked to be spoken, in fixture order, never before its score is
on screen and never still running when the segment cuts. Whisper writes "2 zu
1" where piper was given "zwei zu eins", so both spellings are accepted — that
is the transcriber's convention, not a defect in the audio.

`verify_reel.py` checks the claim the short cut actually makes — that the
caption is ON the word. The audio comes back out of the mp4, every caption's
spoken words are located in the transcript in order, and the gap between when
the caption appears and when the word is said has to stay inside 0.40 s.
`--selftest` slides a good file's audio 2.5 s late and requires the check to
complain; a sync test that cannot go red is worth less than no test.

Plus the data rules he asked for, asserted per file: every published price
inside 5.00-20.00, no scoreline repeated unless forced, and no fixture where the
two brands share a result. Package spread came out 5.34 to 18.34, average 10.56.

## reel.py v2 — the ladder, the hook and the reasoning beat (2 Sept)

His second brief: @billhpicks structure end to end — hook, pick, stats, action,
payoff, CTA — plus a vertical progress bar on the left that starts blurred and
clears as each part of the pick lands.

* **The bar is a real mechanic, not a graphic.** Three rungs per pick, and they
  are pinned to the spoken score through the same word timestamps the captions
  use: rung one lights on the home number, rung two on the away number, rung
  three when the score finishes. Change a scoreline and the bar re-times itself.
* **Unlit rungs must not contain the number.** The first cut drew
  "STUTTGART 2 / KÖLN 1 / EXAKT 2:1" behind a blur, and blurred 40pt type is
  perfectly readable — the bar handed over the answer the card spends eight
  seconds building to. Unlit now reads "STUTTGART ?".
* **Out, then in — never a cross-fade.** The two states carry different words,
  so fading between them draws both at once and reads as a rendering fault.
* `verify_reel.py` asserts the bar cannot light before the score is spoken —
  the same defect as an early card reveal, in a place the card check never
  looks. Tested by rigging a manifest two seconds early: 3 complaints, one per
  pick.
* **The reasoning beat is spoken but not captioned.** A stat sentence drawn one
  190pt word at a time is nine cuts that say nothing. It gets a panel — one
  number, one label — while the voice reads the sentence.
* A pick now runs ~8s, so it **cuts once, on the stat beat**: a real edit point
  rather than an arbitrary midpoint.
* A caption's `off` is clamped to HOLD past its own word. Without it the last
  word of the fixture line hung through the whole stat sentence — four seconds
  of "KÖLN" in 190pt over a panel of numbers, because the next caption in that
  segment was not until the tip line.
* The retake guard keys on `lines[-1]`, not `lines[1]`. The stat line sits in
  the middle and is full of digits ("29 von 38"), so a fixed index had the
  guard listening for a scoreline in the wrong sentence.
* **There is no payoff beat.** These run before kick-off; nothing has been won.
  See below.

## formstats.py — where the stats come from
Derived from the provider's own goal-by-goal timelines for the last completed
season. Nothing typed, nothing estimated.

* **The own-goal convention was measured, not assumed.** 20 of the Bundesliga's
  990 goal events were own goals. Crediting the event's `team` as-is matched
  the provider's own final scores 306/306; flipping own goals to the opponent
  matched 287 and broke 19. The instinctive fix was the wrong one.
  `formstats.py --check` re-runs that comparison.
* **A stat has to point at the pick.** The first version quoted Genoa's clean
  sheets under a pick of "Genoa 0" — true, and an argument for the opposite of
  the pick. A clean sheet is about conceding; the pick was about scoring.
* **Head-to-head is same-orientation only.** Matching both legs made "this
  fixture finished 3:1 last season" describe a game in which the 3 belonged to
  tonight's away side.
* **Measured against the league's own base rate, not a flat count.** "Valencia
  failed to score in 9 of 38" is 24% where La Liga's average is 24% — a true
  sentence that quietly argues against the pick it is there to support.
* 88 of 100 picks get a line. The other 12 run a two-line segment rather than
  say something weak.

## The payoff / WIN beat — why it is not in these two files
He asked for GOAL → ASSIST → WIN, the bar filling as the action happens, and a
big CASHED at the end. Two things are in the way, and only one of them is
technical:

1. The bar filling on real goals needs footage of those goals. That is
   broadcast material and it is the one part of this format that gets a brand
   account struck rather than throttled.
2. **Nothing we have published has finished yet.** Every tips file on disk —
   including both earlier ones in git — is this weekend's matchday, kicking off
   4-7 Sept. There is no settled published pick anywhere to recap.

`--mode result` DOES NOT EXIST YET. Nothing in reel.py takes that flag; the
`script()` docstring says the payoff beat is missing and that is the whole of
it. It is deliberately unbuilt rather than half-built, because the only way to
demo it today would be to render a win against a match we never tipped, and
that is a fabricated track record whether or not the caption admits it. When
the weekend settles there will be real published picks and real results, and
the beat gets built against those — with the render refusing any fixture that
has no stored pick matching the final score.
