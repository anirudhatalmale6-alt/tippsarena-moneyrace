#!/usr/bin/env python3
"""Short-form "pick reel" in the billhpicks style he sent (5 screenshots).

    python3 reel.py                          # both brands, default league
    python3 reel.py --brand luxtipps 39 --picks 3
    python3 reel.py --brand tippsarena 78 --bg stadium

What that format actually is, taken apart from his screenshots:

  * real football moving behind everything, cropped hard to 9:16 and drifting
    (never a static image - the movement is what stops the thumb);
  * ONE word at a time, enormous, bright green with a heavy black outline,
    landing exactly on the syllable;
  * a small dark card at the top naming the pick - "Unai Simon / Higher 2.5
    Saves" - which is the only place the actual information lives;
  * no intro, no logo animation, no music bed of its own.

The captions are the whole trick, and they are the reason this needed the
voiceover first. A caption cut by hand against a waveform is always a frame or
two out and it reads as cheap. Here the narration is synthesized (piper,
offline - see narrate.py), then the finished wav is run back through whisper
with word timestamps, and every caption is placed on the word it belongs to.
So the words cannot drift, and a re-render with a different score re-times
itself.

Whisper's transcript is used for TIMING ONLY. What gets drawn is my own script
text, aligned onto it - otherwise a mis-heard club name would be published in
90pt letters. Where whisper misses a word entirely the gap is interpolated
between the two words it did hear.

THE FOOTAGE. His references run broadcast clips (World Cup, La Liga). That is
the one part of the format that gets a brand account struck rather than merely
throttled, so nothing here ships with broadcast footage in it. `--bg broll`
uses royalty-free clips that fetch_broll.sh downloads (Coverr / Mixkit, both
free for commercial use); `--bg stadium` uses the procedural night stadium from
poster.py and touches no third-party frame at all. Dropping his own licensed
clips in is a matter of putting files in the broll folder.
"""
from __future__ import annotations

import argparse
import difflib
import json
import math
import pathlib
import subprocess
import wave

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

import formstats as FS
import narrate as N
import poster as P
import tips_video as T

W, H = 1080, 1920
FPS = 30
ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out" / "reels"
WORK = ROOT / "out" / "vo"
SCRATCH = N.VENV.parent
BROLL = SCRATCH / "broll"

LEAD = 0.20      # silence before the first word of a segment
GAP = 0.12       # between the spoken lines of a pick
TAIL = 0.30      # after the last word, before the cut
POP = 0.13       # how long a caption word takes to snap to full size
HOLD = 0.28      # how long the last word of a line stays up

CARD_Y = 300     # top of the pick card
CAP_Y = 1255     # centre line of the captions

#: The source is rendered larger than the frame and a 1080x1920 window is
#: walked across it, which is where the drift comes from. 20% slack is enough
#: to be felt over three seconds and not enough to look like a zoom.
OVER = 1.20

# Caption colour per brand. TippsArena gets its own orange rather than the
# green everybody in this niche uses - on grass it reads just as hard and it is
# the one frame-filling element that can carry the brand without any text.
CAP_FILL = {"tippsarena": (255, 110, 3), "luxtipps": (34, 255, 85)}

#: Which clip runs under which segment. The crowd bookends it; the pitch
#: clips rotate underneath the picks so three in a row never look like one shot.
CLIPS = {
    "hook": ["cheering-soccer-fans-5833"],
    "pick": ["mixkit-43495", "mixkit-43484", "mixkit-43499", "mixkit-43483",
             "soccer-warm-up-4701"],
    "outro": ["cheering-soccer-fans-5833"],
}

STR = {
    "de": {"n": ["", "EIN", "ZWEI", "DREI", "VIER", "FÜNF", "SECHS"],
           "n_say": ["", "ein", "zwei", "drei", "vier", "fuenf", "sechs"],
           "tips": "TIPPS", "tips_say": "Tipps",
           "for": "FÜR DEN", "for_say": "fuer den",
           "day": "SPIELTAG", "day_say": "Spieltag",
           "vs": "GEGEN", "vs_say": "gegen",
           "we": "WIR SAGEN", "we_say": "Wir sagen",
           # The hook. A question, not a promise - this is a licensed
           # gambling brand and "the easiest money today" is the one line
           # that turns a creative into a compliance problem.
           "hook": "KLINGT VERRÜCKT", "hook_say": "Klingt verrueckt",
           "o1": "JEDEN SPIELTAG", "o1_say": "Jeden Spieltag",
           "o2": "NEUE TIPPS", "o2_say": "neue Tipps",
           "cta": "FOLGEN", "cta_say": "Folgen",
           "tip": "TIPP", "exact": "EXAKT", "won": "GEWONNEN"},
    "en": {"n": ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"],
           "n_say": ["", "one", "two", "three", "four", "five", "six"],
           "tips": "PICKS", "tips_say": "picks",
           "for": "FOR THE", "for_say": "for the",
           "day": "WEEKEND", "day_say": "weekend",
           "vs": "VS", "vs_say": "against",
           "we": "WE SAY", "we_say": "We say",
           "hook": "SOUNDS CRAZY", "hook_say": "Sounds crazy",
           "o1": "NEW PICKS", "o1_say": "New picks",
           "o2": "EVERY MATCHDAY", "o2_say": "every matchday",
           "cta": "FOLLOW", "cta_say": "Follow",
           "tip": "PICK", "exact": "EXACT", "won": "WINNER"},
}


# ----------------------------------------------------------------- the script
class Line:
    """One spoken sentence and the caption tokens laid over it.

    A caption token is not a word: "2:1" is drawn as one token but spoken as
    three ("zwei zu eins"), and that is the whole reason display text and
    spoken text are carried separately rather than one being derived from the
    other.
    """

    def __init__(self, key: str, chunks: list[tuple[str, str]],
                 caption: bool = True):
        self.key = key
        self.chunks = chunks
        #: The reasoning beat is spoken but NOT captioned word by word. A
        #: sentence like "Como scored in 29 of 38 games last season" drawn one
        #: 190pt word at a time is nine cuts that say nothing; it gets a stat
        #: panel instead, which is also what his reference does with numbers.
        self.caption = caption
        self.text = " ".join(s for _, s in chunks) + "."
        self.words = [w for _, s in chunks for w in s.split()]

    def spans(self, times: list[tuple[float, float]]):
        """(display, spoken, start, end, per-word times) per caption token.

        The individual word times are carried through into the manifest so the
        verifier can check that a caption landed on the words it is captioning
        rather than only that it exists - and so it can do that per word, with
        no interpolation of its own.
        """
        out, i = [], 0
        for disp, spoken in self.chunks:
            n = len(spoken.split())
            out.append((disp, spoken, times[i][0], times[i + n - 1][1],
                        list(zip(spoken.split(), times[i:i + n]))))
            i += n
        return out


def script(b: T.Brand, data: dict, fx: list[dict]) -> list[dict]:
    """Segments, in order: hook, one per pick, CTA.

    The shape he asked for - hook, pick, reasoning, payoff, CTA - with one
    deliberate omission: there is no payoff beat. These run BEFORE kick-off,
    so nothing has been won, and every tips file on disk is this weekend's
    matchday. The only way to show a WIN today would be to claim one on a
    match we never tipped. That beat gets built once real published picks have
    settled - see TIPS.md. Nothing here takes a --mode flag yet.
    """
    s = STR[b.lang]
    lang = b.lang
    league = data["league"]
    segs = [{"kind": "hook", "fx": None, "stat": None, "ladder": None,
             "lines": [
                 # First two seconds. A question, so the viewer stays to find
                 # out what is crazy about it.
                 Line("h0", [(s["hook"], s["hook_say"])]),
                 Line("h1", [(league.upper(), N._plain(league)),
                             (s["n"][len(fx)], s["n_say"][len(fx)]),
                             (s["tips"], s["tips_say"]),
                             (s["for"], s["for_say"]),
                             (s["day"], s["day_say"])]),
             ]}]

    for i, f in enumerate(fx, 1):
        score = f["picks"][b.key]["score"]
        home, away = f["home_short"], f["away_short"]
        gh, ga = score.split(":")
        lines = [Line(f"a{i}", [(home.upper(), N.say(home, lang)),
                                (s["vs"], s["vs_say"]),
                                (away.upper(), N.say(away, lang))])]
        st = FS.stat_line(data["league_id"], f, score, lang)
        if st:
            lines.append(Line(f"s{i}", [("", st["say"])], caption=False))
        # The tip line is always last. plan() finds it that way rather than by
        # index, because the stat line is missing for about one pick in eight
        # and a fixed index would silently time the ladder off the wrong line.
        lines.append(Line(f"b{i}", [(s["we"], s["we_say"]),
                                    (score, N.score_words(score, lang))]))
        # Two texts per rung, unlit and lit. The unlit one must NOT contain
        # the number: blurred 40pt type is still perfectly readable, so a
        # ladder that says "STUTTGART 2" from frame one hands over the answer
        # the card spends eight seconds building up to. It reads the score out
        # before the voice does.
        segs.append({"kind": "pick", "fx": f, "stat": st, "lines": lines,
                     "ladder": [(f"{home.upper()}  ?", f"{home.upper()}  {gh}"),
                                (f"{away.upper()}  ?", f"{away.upper()}  {ga}"),
                                (f"{s['exact']}  ?:?", f"{s['exact']}  {score}")]})

    segs.append({"kind": "outro", "fx": None, "stat": None, "ladder": None,
                 "lines": [Line("z1", [(s["o1"], s["o1_say"]),
                                       (s["o2"], s["o2_say"])]),
                           Line("z2", [(s["cta"], s["cta_say"])])]})
    return segs


# ------------------------------------------------------------------- alignment
#: Whisper writes the same spoken score as "zwei zu eins", "2 zu 1" or "2:1",
#: and it picks differently from one file to the next. Both sides of the
#: comparison are reduced to digits so its spelling cannot matter.
DIGIT = {"null": "0", "eins": "1", "zwei": "2", "drei": "3", "vier": "4",
         "fuenf": "5", "fünf": "5", "sechs": "6", "sieben": "7", "acht": "8",
         "neun": "9", "nil": "0", "zero": "0", "nought": "0", "one": "1",
         "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
         "seven": "7", "eight": "8", "nine": "9"}


def _norm(w: str) -> str:
    """One spelling for a spoken word, whoever wrote it down.

    Whisper writes "Köln" where the voice was fed "Koeln", and "für" where it
    was fed "fuer". That is the transcriber's convention, not a difference in
    the audio, so both sides go through the same umlaut flattening before
    anything is compared - the same trap that once made me report nineteen
    plainly audible scorelines as never spoken.
    """
    w = "".join(c for c in N._plain(w).lower() if c.isalnum())
    return DIGIT.get(w, w)


def similar(a: str, b: str) -> bool:
    """Is this the same word? Used to LOCATE a known word in a transcript, not
    to judge the transcript - a near miss on a club name is still that club."""
    return a == b or difflib.SequenceMatcher(a=a, b=b).ratio() >= 0.74


def align(wav: str, words: list[str], dur: float, lang: str,
          model) -> list[tuple[float, float]]:
    """Per-word (start, end) for a known script, timed off the actual audio.

    Whisper is the clock, not the copy. Its transcript is matched against my
    word list with a plain sequence diff; every word it heard in the right
    place becomes an anchor, and anything it dropped or invented is filled in
    between the surrounding anchors, weighted by word length. A line whose
    words all go unmatched still comes back sensible - just evenly spread.
    """
    segs, _ = model.transcribe(wav, language=lang, word_timestamps=True)
    hyp = [(_norm(w.word), float(w.start), float(w.end))
           for s in segs for w in s.words if _norm(w.word)]
    ref = [_norm(w) for w in words]

    anchor: dict[int, tuple[float, float]] = {}
    at_hyp: dict[int, int] = {}
    sm = difflib.SequenceMatcher(a=ref, b=[h[0] for h in hyp], autojunk=False)
    for i, j, n in sm.get_matching_blocks():
        for k in range(n):
            anchor[i + k] = (hyp[j + k][1], hyp[j + k][2])
            at_hyp[i + k] = j + k

    # Second pass, for the words the exact diff could not place. Whisper splits
    # "Newcastle" into "New castle" and writes "Köln" for "Koeln", and an
    # unanchored word gets its time interpolated instead - which is how a
    # caption ends up landing four tenths of a second before it is said. So
    # each gap is searched again, allowing a near miss and allowing two
    # adjacent heard words to be one script word.
    lo = 0
    for i in range(len(ref)):
        if i in anchor:
            lo = at_hyp[i] + 1
            continue
        hi = min((at_hyp[k] for k in sorted(at_hyp) if k > i), default=len(hyp))
        for j in range(lo, hi):
            merged = hyp[j][0] + hyp[j + 1][0] if j + 1 < hi else None
            if similar(hyp[j][0], ref[i]):
                anchor[i], at_hyp[i] = (hyp[j][1], hyp[j][2]), j
            elif merged and similar(merged, ref[i]):
                anchor[i], at_hyp[i] = (hyp[j][1], hyp[j + 1][2]), j + 1
            else:
                continue
            lo = at_hyp[i] + 1
            break

    out: list[tuple[float, float]] = [(0.0, 0.0)] * len(ref)
    known = sorted(anchor)
    # Walk the gaps between anchors (with the clip's own ends as the outer
    # two) and share each gap out by character count.
    bounds = [-1] + known + [len(ref)]
    for a, c in zip(bounds, bounds[1:]):
        if c - a <= 1:
            if 0 <= a < len(ref):
                out[a] = anchor[a]
            continue
        t0 = anchor[a][1] if a >= 0 else 0.0
        t1 = anchor[c][0] if c < len(ref) else dur
        idx = range(a + 1, c)
        wgt = [len(ref[i]) + 1 for i in idx]
        span, at = max(t1 - t0, 0.01), t0
        for i, g in zip(idx, wgt):
            step = span * g / sum(wgt)
            out[i] = (at, at + step)
            at += step
        if 0 <= a < len(ref):
            out[a] = anchor[a]
    for i in known:
        out[i] = anchor[i]
    return out


# ---------------------------------------------------------------------- timing
def plan(b: T.Brand, segs: list[dict], model) -> dict:
    """Synthesize every line, time every word, and decide how long each
    segment has to be. The voice sets the length; nothing is spoken faster to
    fit a grid, and nothing is cut off at a boundary."""
    lines = {ln.key: ln.text for sg in segs for ln in sg["lines"]}
    tag = f"reel-{b.key}"
    clips = N._synth(b.lang, lines, tag)
    # Same guard as the long cut: a tip line whose numbers cannot be heard gets
    # another take. The voice slurs "null" about one line in fifty, and here it
    # would also mistime the caption that draws the score.
    expect = {}
    for sg in segs:
        if sg["kind"] == "pick":
            # lines[-1], not lines[1]: the stat line sits in the middle for
            # most picks and is absent for the rest, so a fixed index would
            # have the retake guard listening to the wrong sentence for a
            # score - and passing, because that sentence has no digits to
            # mishear.
            expect[sg["lines"][-1].key] = [
                c for c in sg["fx"]["picks"][b.key]["score"] if c.isdigit()]
    clips = N.confirm(b.lang, lines, clips, expect, tag)

    frames, at = [], 0                      # `at` counts FRAMES, never seconds
    audio, caps, reveals, rungs, stats = {}, [], [], [], []
    for sg in segs:
        starts, t = [], LEAD
        for ln in sg["lines"]:
            starts.append(t)
            t += clips[ln.key]["dur"] + GAP
        seg = math.ceil((t - GAP + TAIL) * FPS)
        base = at / FPS
        spans = {}
        for ln, st in zip(sg["lines"], starts):
            audio[ln.key] = base + st
            if not ln.caption:
                # Spoken, never captioned. No alignment either - nothing on
                # screen is timed off its individual words.
                spans[ln.key] = None
                continue
            wt = align(clips[ln.key]["file"], ln.words,
                       clips[ln.key]["dur"], b.lang, model)
            spans[ln.key] = [(disp, say, base + st + a, base + st + c,
                              [[w, base + st + s, base + st + e]
                               for w, (s, e) in per])
                             for disp, say, a, c, per in ln.spans(wt)]
            for disp, say, a, c, per in spans[ln.key]:
                caps.append({"seg": len(frames), "text": disp, "say": say,
                             "at": a, "end": c, "words": per})

        rung = None
        reveal = None
        if sg["kind"] == "pick":
            # The rungs are pinned to the spoken score, not to the segment.
            # "null zu eins" is three words and "nil one" is two, so the away
            # number is the LAST word either way and the home number the
            # first - the bar fills exactly as the number leaves the mouth.
            per = spans[sg["lines"][-1].key][-1][4]
            rung = [per[0][1], per[-1][1], per[-1][2] + 0.06]
            # The card carries the score a beat before it is said, never after.
            reveal = per[0][1] - 0.10
        reveals.append(reveal)
        rungs.append(rung)
        # The stat panel arrives with the sentence that explains it and stays
        # up for the rest of the segment.
        si = next((i for i, ln in enumerate(sg["lines"])
                   if not ln.caption), None)
        stats.append(None if si is None else base + starts[si] - 0.12)
        frames.append(seg)
        at += seg

    # A caption stays up until the next one, but never for longer than HOLD
    # past its own word. Without the clamp the last word of the fixture line
    # hung on through the entire stat sentence - four seconds of "KOELN" in
    # 190pt over a panel of numbers, because the next caption in that segment
    # was not until the tip line and the stat line has no captions at all.
    for i, c in enumerate(caps):
        nxt = caps[i + 1] if i + 1 < len(caps) else None
        stop = c["end"] + HOLD
        c["off"] = (min(nxt["at"], stop) if nxt and nxt["seg"] == c["seg"]
                    else stop)
    return {"frames": frames, "audio": audio, "caps": caps,
            "reveals": reveals, "rungs": rungs, "stats": stats,
            "clips": clips, "fps": FPS, "lang": b.lang, "texts": lines}


def write_track(pl: dict, path: pathlib.Path) -> pathlib.Path:
    sr = next(iter(pl["clips"].values()))["sr"]
    total = sum(pl["frames"])
    buf = np.zeros(int(round(total / FPS * sr)) + sr, dtype=np.int32)
    for key, at in pl["audio"].items():
        with wave.open(pl["clips"][key]["file"]) as w:
            a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        i = int(round(at * sr))
        buf[i:i + len(a)] += a
    buf = np.clip(buf, -32768, 32767).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(buf.tobytes())
    # piper's duration predictor samples, so the same script is a few frames
    # longer every time it is synthesized. What was actually muxed is written
    # down here; the verifier reads this and never re-runs the generator.
    path.with_suffix(".json").write_text(json.dumps(
        {k: v for k, v in pl.items() if k != "clips"}, indent=1,
        ensure_ascii=False), encoding="utf-8")
    return path


# --------------------------------------------------------------------- drawing
_cap: dict = {}


def word(text: str, fill) -> Image.Image:
    """One caption word: heavy outline, soft shadow, drawn once and cached."""
    key = (text, fill)
    if key in _cap:
        return _cap[key]
    # 820, not 1080: the word grows to 1.12x on the pop, and a caption that
    # overflows the frame is drawn half off the canvas rather than refused.
    size, pad = 190, 30
    f = P.font(size)
    while f.getlength(text) > 820 and size > 64:
        size -= 6
        f = P.font(size)
    box = f.getbbox(text, stroke_width=18)
    im = Image.new("RGBA", (box[2] - box[0] + pad * 2,
                            box[3] - box[1] + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((pad - box[0], pad - box[1]), text, font=f,
                            fill=fill + (255,), stroke_width=18,
                            stroke_fill=(0, 0, 0, 255))
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sh.putalpha(im.getchannel("A").filter(ImageFilter.GaussianBlur(12)))
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (0, 12))
    out.alpha_composite(im)
    _cap[key] = out
    return out


def _alpha(im: Image.Image, a: float) -> Image.Image:
    """A copy of `im` at `a` of its own opacity, for cross-fading."""
    out = im.copy()
    out.putalpha(out.getchannel("A").point(lambda v: int(v * a)))
    return out


def crest_disc(b: T.Brand, crest: str | None, size: int) -> Image.Image:
    """A crest on a light disc, because a crest on grass is unreadable for half
    the clubs in Europe.

    The two brands do not share it. LuxTipps already owns the cream-and-gold
    ring from the prediction videos; reusing it on TippsArena is exactly the
    "hm, this is actually the same site" he asked me to design away from, so
    the dark brand gets a plain white disc with an orange rim instead.
    """
    key = ("reeldisc", b.key, crest, size)
    if key in P._cache:
        return P._cache[key]
    if b.style == "light":
        im = T.badge(crest, size)
    else:
        im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.ellipse((0, 0, size - 1, size - 1), fill=b.accent)
        pad = int(size * 0.075)
        d.ellipse((pad, pad, size - 1 - pad, size - 1 - pad),
                  fill=(252, 252, 252))
        T._crest_into(im, crest, size, 0.60)
    P._cache[key] = im
    return im


def _crests(b: T.Brand, fx: dict, size: int) -> Image.Image:
    im = Image.new("RGBA", (int(size * 1.72), size), (0, 0, 0, 0))
    for i, c in enumerate((fx["home_crest"], fx["away_crest"])):
        im.alpha_composite(crest_disc(b, c, size), (int(i * size * 0.72), 0))
    return im


def pick_card(b: T.Brand, fx: dict, score: str | None) -> Image.Image:
    """The top card. Two states - with the score and without - so the reveal
    is a swap rather than a redraw."""
    cw, ch = W - 120, 236
    im = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    dark = b.style == "dark"
    d.rounded_rectangle((0, 0, cw - 1, ch - 1), 34,
                        fill=(10, 12, 16, 226) if dark else (243, 240, 232, 232))
    ink = (247, 250, 253) if dark else T.CHAR
    sub = (150, 163, 178) if dark else (120, 116, 106)

    im.alpha_composite(_crests(b, fx, 132), (26, (ch - 132) // 2))
    x = 26 + int(132 * 1.72) + 26

    # Uppercase with a dash, not "Stuttgart Gegen Koeln" - a title-cased
    # preposition in the middle of two club names reads as a sentence that
    # somebody forgot to finish.
    name = f"{fx['home_short'].upper()}  –  {fx['away_short'].upper()}"
    size = 56
    while P.font(size).getlength(name) > cw - x - 30 and size > 30:
        size -= 2
    d.text((x, 84), name, font=P.font(size), fill=ink, anchor="lm")

    lab = STR[b.lang]["tip"]
    d.text((x, 156), lab, font=P.font(40), fill=sub, anchor="lm")
    if score:
        d.text((x + P.font(40).getlength(lab) + 22, 154), score,
               font=P.font(62), fill=b.accent, anchor="lm")
    return im


# ------------------------------------------------------------------ the ladder
LAD_X, LAD_Y = 54, 742     # top-left of the first rung
LAD_STEP = 132             # centre to centre
LAD_W = 430
NODE = 46
FADE = 0.30                # out-then-in, so the two texts never overlap


def lad_row(b: T.Brand, text: str, live: bool) -> Image.Image:
    """One rung of the progress bar, in one of its two states.

    Unlit rungs are blurred rather than merely dimmed. Dimming alone reads as
    "disabled"; blur reads as "not yet known", which is the feeling he asked
    for - the viewer can see there are three steps and cannot yet read them.
    """
    key = ("lad", b.key, text, live)
    if key in P._cache:
        return P._cache[key]
    h = NODE + 16
    im = Image.new("RGBA", (LAD_W, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cy = h // 2
    box = (2, cy - NODE // 2, 2 + NODE, cy + NODE // 2)
    if live:
        d.ellipse(box, fill=b.accent)
        cx = 2 + NODE // 2
        d.line([(cx - 11, cy), (cx - 3, cy + 9), (cx + 12, cy - 10)],
               fill=(255, 255, 255), width=7, joint="curve")
        ink, stroke = (255, 255, 255), 6
    else:
        d.ellipse(box, fill=(255, 255, 255, 38),
                  outline=(255, 255, 255, 120), width=4)
        ink, stroke = (235, 238, 242), 5

    size = 40
    f = P.font(size)
    while f.getlength(text) > LAD_W - NODE - 34 and size > 22:
        size -= 2
        f = P.font(size)
    d.text((2 + NODE + 22, cy), text, font=f, fill=ink, anchor="lm",
           stroke_width=stroke, stroke_fill=(0, 0, 0, 205))
    if not live:
        im = im.filter(ImageFilter.GaussianBlur(3.4))
        im.putalpha(im.getchannel("A").point(lambda v: int(v * 0.62)))
    P._cache[key] = im
    return im


def lad_rail(n: int) -> Image.Image:
    key = ("ladrail", n)
    if key in P._cache:
        return P._cache[key]
    h = (n - 1) * LAD_STEP + NODE + 16
    im = Image.new("RGBA", (LAD_W, h), (0, 0, 0, 0))
    x = 2 + NODE // 2
    ImageDraw.Draw(im).line([(x, (NODE + 16) // 2),
                             (x, (n - 1) * LAD_STEP + (NODE + 16) // 2)],
                            fill=(255, 255, 255, 62), width=5)
    P._cache[key] = im
    return im


def stat_panel(b: T.Brand, st: dict) -> Image.Image:
    """The reasoning beat: one number the eye lands on, and what it counts."""
    key = ("stat", b.key, st["big"], st["label"])
    if key in P._cache:
        return P._cache[key]
    w, h = W - 120, 132
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    dark = b.style == "dark"
    d.rounded_rectangle((0, 0, w - 1, h - 1), 28,
                        fill=(10, 12, 16, 214) if dark else (243, 240, 232, 226))
    ink = (247, 250, 253) if dark else T.CHAR
    sub = (150, 163, 178) if dark else (120, 116, 106)

    size = 66
    f = P.font(size)
    while f.getlength(st["big"]) > 300 and size > 34:
        size -= 3
        f = P.font(size)
    d.text((30, h // 2), st["big"], font=f, fill=b.accent, anchor="lm")
    x = 30 + f.getlength(st["big"]) + 26

    size = 36
    lf = P.font(size)
    while lf.getlength(st["label"]) > w - x - 26 and size > 20:
        size -= 2
        lf = P.font(size)
    d.text((x, h // 2), st["label"], font=lf, fill=sub, anchor="lm")
    P._cache[key] = im
    return im


def furniture(b: T.Brand) -> Image.Image:
    """Everything that never changes: the darkening that makes text readable
    over moving grass, and the brand disc. No handle, no CTA - he stripped all
    footer text off the prediction videos and this format has less room for it,
    not more."""
    g = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(g)
    for y in range(H):
        # dark at the very top (behind the card) and across the caption band
        top = max(0.0, 1 - y / 620) * 150
        bot = max(0.0, (y - 900) / (H - 900)) * 120
        gd.line([(0, y), (W, y)], fill=int(min(200, top + bot)))
    # ...and a soft column down the left, where the progress bar lives. Its
    # rungs carry a black outline, but a white node on a white shirt is still
    # a coin toss, and this is the one element that must stay legible for the
    # whole video rather than for one beat.
    col = Image.new("L", (W, H), 0)
    cd = ImageDraw.Draw(col)
    for x in range(560):
        cd.line([(x, LAD_Y - 90), (x, LAD_Y + 2 * LAD_STEP + 130)],
                fill=int(96 * (1 - x / 560)))
    # Blurred, or its top and bottom edges draw two hard horizontal lines
    # across the left half of the frame - clearly visible over a flat sky.
    col = col.filter(ImageFilter.GaussianBlur(70))
    g.paste(ImageChops.lighter(g, col))
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    im.paste((0, 0, 0, 255), (0, 0, W, H), g)
    im.alpha_composite(b.disc(104), (60, 132))
    return im


# -------------------------------------------------------------------- the bake
def bg_frames(clip: str, n: int, bg: str):
    """Yield `n` RGB arrays, each OVER x the frame, already 9:16 and looping."""
    ow, oh = int(W * OVER), int(H * OVER)
    if bg == "stadium":
        # No motion of its own - the window walk below is the only movement,
        # which is a pan across a painting rather than football. It is the
        # option for the day he wants zero third-party frames in the file.
        seed = sum(ord(c) for c in clip) % 97
        arr = np.asarray(P.stadium(ow, oh, seed=seed).convert("RGB"))
        for _ in range(n):
            yield arr
        return
    src = BROLL / f"{clip}.mp4"
    if not src.exists():
        raise SystemExit(f"missing b-roll {src} - run fetch_broll.sh")
    p = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-stream_loop", "-1", "-i", str(src), "-an",
         "-vf", f"fps={FPS},crop=ih*9/16:ih,scale={ow}:{oh},"
                "eq=brightness=-0.04:saturation=1.18:contrast=1.06",
         "-frames:v", str(n), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE)
    size = ow * oh * 3
    try:
        for _ in range(n):
            raw = p.stdout.read(size)
            if len(raw) < size:
                break
            yield np.frombuffer(raw, np.uint8).reshape(oh, ow, 3)
    finally:
        p.stdout.close()
        p.wait()


def shots(sg: dict, si: int, n: int, start: int, pl: dict) -> list[tuple[str, int]]:
    """Which clip runs under this segment, and where it cuts.

    A pick now runs eight seconds - name, reasoning, tip - and eight seconds of
    one continuous shot is the thing that makes a reel feel like a slideshow
    however fast the captions move. So a pick cuts once, on the stat beat,
    which is a real edit point rather than an arbitrary halfway mark: the
    picture changes exactly when the subject does.
    """
    pool = CLIPS[sg["kind"]]
    if sg["kind"] != "pick":
        return [(pool[0], n)]
    a, b = pool[(2 * si) % len(pool)], pool[(2 * si + 1) % len(pool)]
    at = pl["stats"][si]
    cut = n // 2 if at is None else int(round((at - start / FPS) * FPS))
    cut = max(FPS // 2, min(cut, n - FPS // 2))       # never a flash frame
    return [(a, cut), (b, n - cut)]


def chain(shot_list: list[tuple[str, int]], bg: str):
    for clip, count in shot_list:
        if count <= 0:
            continue
        yield from bg_frames(clip, count, bg)


def render(brand_key: str, league_id: int, picks: int, bg: str,
           model) -> pathlib.Path:
    b = T.BRANDS[brand_key]
    data = json.loads((T.DATA / f"tips-{league_id}.json").read_text(encoding="utf-8"))
    # Three is the format: the hook promises a number and the viewer has to be
    # able to hold it. Past six the spoken count has no word in STR either.
    picks = max(2, min(picks, 6))
    fx = [f for f in data["fixtures"] if brand_key in f.get("picks", {})][:picks]
    segs = script(b, data, fx)
    pl = plan(b, segs, model)
    wav = write_track(pl, OUT / "vo" / f"{brand_key}-{data['slug']}.wav")

    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{brand_key}-reel-{data['slug']}.mp4"
    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-framerate", str(FPS), "-i", "-", "-i", str(wav),
         "-c:a", "aac", "-b:a", "128k", "-shortest",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE)

    fur = furniture(b)
    fill = CAP_FILL[brand_key]
    ow, oh = int(W * OVER), int(H * OVER)
    slack = (ow - W, oh - H)
    at = 0
    for si, (sg, n) in enumerate(zip(segs, pl["frames"])):
        card = None
        rows = rail = None
        panel = None
        if sg["kind"] == "pick":
            card = (pick_card(b, sg["fx"], None),
                    pick_card(b, sg["fx"], sg["fx"]["picks"][brand_key]["score"]))
            rows = [(lad_row(b, dim, False), lad_row(b, live, True))
                    for dim, live in sg["ladder"]]
            rail = lad_rail(len(rows))
            if sg["stat"]:
                panel = stat_panel(b, sg["stat"])
        # alternate the drift so three picks in a row do not feel like one shot
        d0, d1 = (0.12, 0.88) if si % 2 == 0 else (0.88, 0.12)
        # ffmpeg can hand back fewer frames than asked for on the last loop of
        # a short clip; the picture must not end before the sentence does, so
        # the final frame is held rather than the segment being shortened.
        gen, last = chain(shots(sg, si, n, at, pl), bg), None
        for k in range(n):
            src = last = next(gen, last)
            if src is None:
                raise SystemExit(f"segment {si}: no frames at all")
            t = (at + k) / FPS
            u = k / max(n - 1, 1)
            a = d0 + (d1 - d0) * u
            x, y = int(slack[0] * a), int(slack[1] * (1 - a))
            frame = Image.fromarray(src[y:y + H, x:x + W]).convert("RGBA")
            frame.alpha_composite(fur)

            if card is not None:
                rev = pl["reveals"][si]
                cd = card[1] if rev is not None and t >= rev else card[0]
                # slides down over the first fifth of a second
                s = min(1.0, (t - at / FPS) / 0.22)
                dy = int((1 - P.ease_out(s)) * -90)
                lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                lay.alpha_composite(cd, (60, CARD_Y + dy))
                if s < 1:
                    lay.putalpha(lay.getchannel("A").point(
                        lambda v: int(v * s)))
                frame.alpha_composite(lay)

            if rows is not None:
                frame.alpha_composite(rail, (LAD_X, LAD_Y))
                for ri, (dim, live) in enumerate(rows):
                    y = LAD_Y + ri * LAD_STEP
                    a = (t - pl["rungs"][si][ri]) / FADE
                    if a <= 0:
                        frame.alpha_composite(dim, (LAD_X, y))
                        continue
                    if a >= 1:
                        frame.alpha_composite(live, (LAD_X, y))
                        continue
                    # Sequential, not a cross-fade. The two states carry
                    # DIFFERENT words ("EXAKT ?:?" and "EXAKT 2:1"), so
                    # overlapping them draws both at once and the rung reads
                    # as a rendering fault rather than a reveal. Out, then in.
                    if a < 0.42:
                        frame.alpha_composite(
                            _alpha(dim, 1 - P.ease_out(a / 0.42)), (LAD_X, y))
                    else:
                        e = P.ease_out((a - 0.42) / 0.58)
                        # a short overshoot on the way in, so a rung snaps
                        # into focus rather than dissolving into it
                        sc = 1 + 0.10 * (1 - e)
                        im = live.resize((int(live.width * sc),
                                          int(live.height * sc)),
                                         Image.BILINEAR)
                        frame.alpha_composite(
                            _alpha(im, e),
                            (LAD_X, y - (im.height - live.height) // 2))

            if panel is not None:
                a = (t - pl["stats"][si]) / 0.30
                if a > 0:
                    e = P.ease_out(min(1.0, a))
                    dx = int((1 - e) * -46)
                    frame.alpha_composite(
                        panel if e >= 1 else _alpha(panel, e),
                        (60 + dx, CARD_Y + 236 + 26))

            for c in pl["caps"]:
                if c["at"] <= t < c["off"]:
                    im = word(c["text"], fill)
                    # snap in past full size and settle back - the overshoot is
                    # what reads as "landing on the beat" rather than fading in
                    e = (t - c["at"]) / POP
                    sc = (0.70 + 0.42 * P.ease_out(e / 0.72) if e < 0.72
                          else 1.12 - 0.12 * P.ease_out((e - 0.72) / 0.28))
                    if abs(sc - 1) > 0.005:
                        im = im.resize((max(1, int(im.width * sc)),
                                        max(1, int(im.height * sc))),
                                       Image.BILINEAR)
                    frame.alpha_composite(im, (max(0, W // 2 - im.width // 2),
                                               CAP_Y - im.height // 2))
                    break
            enc.stdin.write(frame.convert("RGB").tobytes())
        at += n

    enc.stdin.close()
    enc.wait()
    print(f"{out.name}  {sum(pl['frames'])}f  "
          f"{sum(pl['frames']) / FPS:.1f}s  {len(fx)} picks")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("league", nargs="?", type=int, default=78)
    ap.add_argument("--brand", choices=list(T.BRANDS) + ["both"], default="both")
    ap.add_argument("--picks", type=int, default=3)
    ap.add_argument("--bg", choices=["broll", "stadium"], default="broll")
    a = ap.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cpu", compute_type="int8")
    keys = list(T.BRANDS) if a.brand == "both" else [a.brand]
    for k in keys:
        render(k, a.league, a.picks, a.bg, model)


if __name__ == "__main__":
    main()
