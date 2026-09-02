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
from PIL import Image, ImageDraw, ImageFilter

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

LEAD = 0.25      # silence before the first word of a segment
GAP = 0.16       # between the two spoken lines of a pick
TAIL = 0.42      # after the last word, before the cut
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
           "o1": "ALLE TIPPS", "o1_say": "Alle Tipps",
           "o2": "JEDEN SPIELTAG", "o2_say": "jeden Spieltag",
           "tip": "TIPP"},
    "en": {"n": ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"],
           "n_say": ["", "one", "two", "three", "four", "five", "six"],
           "tips": "PICKS", "tips_say": "picks",
           "for": "FOR THE", "for_say": "for the",
           "day": "WEEKEND", "day_say": "weekend",
           "vs": "VS", "vs_say": "against",
           "we": "WE SAY", "we_say": "We say",
           "o1": "ALL TIPS", "o1_say": "All tips",
           "o2": "EVERY MATCHDAY", "o2_say": "every matchday",
           "tip": "PICK"},
}


# ----------------------------------------------------------------- the script
class Line:
    """One spoken sentence and the caption tokens laid over it.

    A caption token is not a word: "2:1" is drawn as one token but spoken as
    three ("zwei zu eins"), and that is the whole reason display text and
    spoken text are carried separately rather than one being derived from the
    other.
    """

    def __init__(self, key: str, chunks: list[tuple[str, str]]):
        self.key = key
        self.chunks = chunks
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
    """Segments, in order: a hook, one per pick, an outro."""
    s = STR[b.lang]
    lang = b.lang
    league = data["league"]
    segs = [{"kind": "hook", "fx": None, "lines": [Line("h1", [
        (league.upper(), N._plain(league)),
        (s["n"][len(fx)], s["n_say"][len(fx)]),
        (s["tips"], s["tips_say"]),
        (s["for"], s["for_say"]),
        (s["day"], s["day_say"]),
    ])]}]

    for i, f in enumerate(fx, 1):
        score = f["picks"][b.key]["score"]
        home, away = f["home_short"], f["away_short"]
        segs.append({"kind": "pick", "fx": f, "lines": [
            Line(f"a{i}", [(home.upper(), N.say(home, lang)),
                           (s["vs"], s["vs_say"]),
                           (away.upper(), N.say(away, lang))]),
            Line(f"b{i}", [(s["we"], s["we_say"]),
                           (score, N.score_words(score, lang))]),
        ]})

    segs.append({"kind": "outro", "fx": None, "lines": [Line("z1", [
        (s["o1"], s["o1_say"]), (s["o2"], s["o2_say"])])]})
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
            expect[sg["lines"][1].key] = [
                c for c in sg["fx"]["picks"][b.key]["score"] if c.isdigit()]
    clips = N.confirm(b.lang, lines, clips, expect, tag)

    frames, at = [], 0                      # `at` counts FRAMES, never seconds
    audio, caps, reveals = {}, [], []
    for sg in segs:
        starts, t = [], LEAD
        for ln in sg["lines"]:
            starts.append(t)
            t += clips[ln.key]["dur"] + GAP
        seg = math.ceil((t - GAP + TAIL) * FPS)
        base = at / FPS
        spans = []
        for ln, st in zip(sg["lines"], starts):
            audio[ln.key] = base + st
            wt = align(clips[ln.key]["file"], ln.words,
                       clips[ln.key]["dur"], b.lang, model)
            spans.append([(disp, say, base + st + a, base + st + c,
                           [[w, base + st + s, base + st + e]
                            for w, (s, e) in per])
                          for disp, say, a, c, per in ln.spans(wt)])
            for disp, say, a, c, per in spans[-1]:
                caps.append({"seg": len(frames), "text": disp, "say": say,
                             "at": a, "end": c, "words": per})
        # The score row on the card flips a beat BEFORE the score is spoken -
        # the number is always on screen by the time the voice says it, never
        # after. The last token of the second line is the score itself.
        reveals.append(spans[1][-1][2] - 0.10 if sg["kind"] == "pick" else None)
        frames.append(seg)
        at += seg

    # a caption stays up until the next one in the same segment, or a beat
    # after its own line ends
    for i, c in enumerate(caps):
        nxt = caps[i + 1] if i + 1 < len(caps) else None
        c["off"] = (nxt["at"] if nxt and nxt["seg"] == c["seg"]
                    else c["end"] + HOLD)
    return {"frames": frames, "audio": audio, "caps": caps,
            "reveals": reveals, "clips": clips, "fps": FPS, "lang": b.lang,
            "texts": lines}


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
        pool = CLIPS[sg["kind"]]
        clip = pool[si % len(pool)] if sg["kind"] == "pick" else pool[0]
        card = None
        if sg["kind"] == "pick":
            card = (pick_card(b, sg["fx"], None),
                    pick_card(b, sg["fx"], sg["fx"]["picks"][brand_key]["score"]))
        # alternate the drift so three picks in a row do not feel like one shot
        d0, d1 = (0.12, 0.88) if si % 2 == 0 else (0.88, 0.12)
        # ffmpeg can hand back fewer frames than asked for on the last loop of
        # a short clip; the picture must not end before the sentence does, so
        # the final frame is held rather than the segment being shortened.
        gen, last = bg_frames(clip, n, bg), None
        for k in range(n):
            src = last = next(gen, last)
            if src is None:
                raise SystemExit(f"{clip}: no frames at all")
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
