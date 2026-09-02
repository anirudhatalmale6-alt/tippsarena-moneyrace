#!/usr/bin/env python3
"""Spoken commentary for the prediction videos.

He asked whether a voiceover is possible at my end. It is, offline: piper
(neural TTS, ONNX) with a German voice for TippsArena and an English one for
LuxTipps. No third-party API, no key of his, no per-video cost, and nothing
leaves this machine.

Two rules shape everything here:

* **The voice drives the cut, not the other way round.** A silent segment is
  3.6 s. "Borussia Moenchengladbach gegen Eintracht Frankfurt. Unser Tipp:
  drei zu zwei." is longer than that, and clipping a sentence at the segment
  boundary is the one mistake a viewer hears instantly. So each fixture's
  segment is stretched to fit its own two lines, and only the still that is
  already on screen is held longer. Nothing is spoken faster to fit a grid.

* **The tip is never spoken before it is shown.** The score appears at REVEAL
  (1.35 s in). The second line starts at REVEAL + 0.12 s, or later if the
  team line is still running - never earlier.

The video stays usable without sound: this adds a track, it does not move any
information into it.
"""
from __future__ import annotations

import json
import math
import pathlib
import subprocess
import unicodedata
import wave

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent
# The venv and the voice models are big and are not source; they live outside
# the repo. install_voices.sh rebuilds both from scratch.
VENV = pathlib.Path("/tmp/claude-1004/-home-freelancer/"
                    "9dbe74e0-4297-4b96-ba61-8a7c42919c50/scratchpad/ttsenv")
VOICES = VENV.parent / "voices"
WORK = ROOT / "out" / "vo"

MODEL = {"de": VOICES / "de_DE-thorsten-high.onnx",
         "en": VOICES / "en_GB-northern_english_male-medium.onnx"}
# thorsten-high reads deliberately; a touch under 1.0 sounds like a presenter
# rather than an announcement board. The English voice is already brisk.
SPEED = {"de": 0.94, "en": 1.0}

LEAD = 0.30      # silence before the first word of a segment
GAP = 0.20       # between the team line and the tip line
TAIL = 0.55      # after the last word, before the cut

NUM = {
    "de": ["null", "eins", "zwei", "drei", "vier", "fuenf", "sechs", "sieben",
           "acht", "neun"],
    "en": ["nil", "one", "two", "three", "four", "five", "six", "seven",
           "eight", "nine"],
}

# Short names are drawn on screen because they have to fit a card. Spoken, a
# few of them are wrong or unreadable, so they are said differently. Anything
# not in here is spoken exactly as it is written on screen.
#
# Two kinds of entry, and it matters which is which:
#
#   * EXPANSIONS - "PSG" is three letters on a card and a club when spoken.
#     These are editorial and I chose them;
#   * RESPELLINGS - "Leipzig" written phonetically as "Lipetsig" for the
#     English voice. These are not opinions. check_names.py synthesizes every
#     club BOTH ways and transcribes both back, and a respelling stays only
#     where it measured more recognisable than the plain spelling. Fifteen of
#     the ones I guessed at measured no better and are gone: my "Stootgart",
#     "Hoffenhime", "Byern", "Liwwerpuhl", "Fullam" and the rest all made their
#     club harder to recognise, not easier. Expansions are judged by eye, not
#     by that number - "Neapel" scores badly against the word "Napoli" for the
#     obvious reason, and is still the right thing for a German voice to say.
#
# A voice reads the language it was trained on. The German voice says the V in
# "Valencia" as an F and the English one has never met "Bochum", so each side
# needs its own spelling of the same club.
SAY = {
    "de": {"PSG": "Paris Saint-Germain", "HSV": "Hamburger S V",
           "Mainz 05": "Mainz null fünf", "St. Pauli": "Sankt Pauli",
           "Man United": "Manchester United", "Man City": "Manchester City",
           "Nottm Forest": "Nottingham Forest", "Depor": "Deportivo",
           "Gladbach": "Borussia Mönchengladbach", "Bremen": "Werder Bremen",
           "Athletic": "Athletic Bilbao", "Sociedad": "Real Sociedad",
           "Celta": "Selta Vigo", "Rayo": "Rayo Vallecano",
           "Inter": "Inter Mailand", "Milan": "A C Mailand",
           "Napoli": "Neapel", "Roma": "A S Rom", "Lazio": "Lazio Rom",
           "Juventus": "Juventus Turin", "Torino": "F C Turin",
           # respellings that measured better than the plain spelling
           "Valencia": "Walensia", "Como": "Komo", "Hull City": "Hall Sitti"},
    "en": {"PSG": "Paris Saint-Germain", "HSV": "Hamburg",
           "Mainz 05": "Mainz", "St. Pauli": "Saint Pauli",
           "Man United": "Manchester United", "Man City": "Manchester City",
           "Nottm Forest": "Nottingham Forest",
           "Gladbach": "Monchengladbach", "Bremen": "Werder Bremen",
           "Athletic": "Athletic Bilbao", "Sociedad": "Real Sociedad",
           "Celta": "Celta Vigo", "Rayo": "Rayo Vallecano",
           "Köln": "Cologne", "Nürnberg": "Nuremberg",
           "Kaiserslautern": "Kaiserslautern",
           # respellings that measured better than the plain spelling
           "Alaves": "Alavess", "Osasuna": "Ossasoona", "Valencia": "Valensia",
           "Lecce": "Letchay", "Leipzig": "Lipetsig", "Bochum": "Bawkum",
           "Lyon": "Leeon", "Lorient": "Loreeon", "Getafe": "Hetafay",
           "Kiel": "Keel", "Bologna": "Bolonya", "Auxerre": "Ohsair",
           "Cottbus": "Cottboos", "Schalke": "Shalka", "Depor": "Deporteevo",
           "Udinese": "Oodinayzay", "Sevilla": "Seveeya"},
}

LINES = {
    "de": {"match": "{home} gegen {away}.", "tip": "Unser Tipp: {score}.",
           "outro": "Alle Tipps, jeden Spieltag."},
    "en": {"match": "{home} against {away}.", "tip": "Our prediction: {score}.",
           "outro": "All tips, every matchday."},
}


def _plain(s: str) -> str:
    """Umlauts and accents, flattened. The English voice mispronounces them
    outright; the German one is fed 'ue'/'oe' spellings, which it reads
    correctly and which survive a JSON round trip on any machine."""
    s = (s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
          .replace("Ä", "Ae").replace("Ö", "Oe").replace("Ü", "Ue")
          .replace("ß", "ss"))
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c))


def _key(s: str) -> str:
    """One lookup key for a club however anybody spelled it.

    The map is not looked up on the flattened spelling. _plain turns "Köln"
    into "Koeln" - an inserted 'e' - so an entry typed "Koln" on an English
    keyboard silently never matched, and LuxTipps read the German spelling out
    loud instead of "Cologne". Stripping the accent instead of expanding it
    makes "Köln", "Koeln" and "Koln" all arrive at the same key.
    """
    s = unicodedata.normalize("NFKD", s.replace("ß", "ss"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "".join(c for c in s.lower() if c.isalnum())


_SAY = {lang: {_key(k): v for k, v in m.items()} for lang, m in SAY.items()}


def say(name: str, lang: str) -> str:
    return _SAY[lang].get(_key(name)) or _plain(name)


def score_words(score: str, lang: str) -> str:
    h, a = (int(x) for x in score.split(":"))
    n = NUM[lang]
    h_w = n[h] if h < len(n) else str(h)
    a_w = n[a] if a < len(n) else str(a)
    if lang == "de":
        return f"{h_w} zu {a_w}"
    # "two nil", not "two zero" - and "nil nil" for a goalless draw.
    return f"{h_w} {a_w}"


class Track:
    """The narration for one video, and the segment lengths it forces."""

    def __init__(self, lang, clips, segments, outro, offsets, fps, texts):
        self.lang, self.clips, self.fps = lang, clips, fps
        self.texts = texts            # {clip key: what it says}
        self.segments = segments      # FRAMES per fixture, in order
        self.outro = outro            # frames
        self.offsets = offsets        # {clip key: absolute seconds}

    def write(self, path: pathlib.Path) -> pathlib.Path:
        """Lay the clips onto one silent track. Every segment boundary was
        rounded to a whole frame before the offsets were computed, so the words
        cannot drift against the pictures over a ten-match video."""
        sr = next(iter(self.clips.values()))["sr"]
        frames = sum(self.segments) + self.outro
        buf = np.zeros(int(round(frames / self.fps * sr)) + sr, dtype=np.int32)
        for key, at in self.offsets.items():
            with wave.open(self.clips[key]["file"]) as w:
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
        # piper is a VITS model: the duration predictor is stochastic, so the
        # same sentence comes out a few frames longer or shorter every time it
        # is synthesized. Re-deriving the timing later would therefore describe
        # a track that was never muxed - so the plan that WAS used is written
        # down beside the wav, and the verifier reads this rather than guessing.
        path.with_suffix(".json").write_text(json.dumps(
            {"segments": self.segments, "outro": self.outro, "fps": self.fps,
             "offsets": self.offsets, "lang": self.lang,
             "texts": self.texts}, indent=1), encoding="utf-8")
        return path


def _synth(lang: str, lines: dict, tag: str) -> dict:
    out = WORK / tag
    job = out / "job.json"
    out.mkdir(parents=True, exist_ok=True)
    job.write_text(json.dumps({"model": str(MODEL[lang]), "out": str(out),
                               "length_scale": SPEED[lang], "lines": lines}),
                   encoding="utf-8")
    r = subprocess.run([str(VENV / "bin" / "python"),
                        str(ROOT / "_tts_worker.py"), str(job)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"tts failed: {r.stderr[-800:]}")
    return json.loads(r.stdout)


def confirm(lang: str, lines: dict, clips: dict, expect: dict, tag: str,
            tries: int = 4) -> dict:
    """Re-synthesize any line whose numbers cannot be heard in it.

    The German voice slurs "null" into something like "Müll" now and then -
    measured at roughly one line in fifty, and it is a lottery, not a phrasing
    problem: over 48 samples a colon and a comma before the score scored 48/48
    and 47/48, so the punctuation theory I tested first was noise. Since piper
    samples a fresh duration and prosody every call, the cure is simply to
    listen to what came out and ask for another take.

    Only lines with an `expect` entry are checked, and only their digits - this
    is a guard against a scoreline nobody can hear, not a judgement on the
    reading.
    """
    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cpu", compute_type="int8")

    def heard(path: str) -> list[str]:
        segs, _ = model.transcribe(path, language=lang)
        text = " ".join(s.text for s in segs)
        digits = []
        for w in text.split():
            w = "".join(c for c in _plain(w).lower() if c.isalnum())
            w = _DIGIT.get(w, w)
            digits += [c for c in w if c.isdigit()]
        return digits

    for attempt in range(tries):
        bad = {k: lines[k] for k, want in expect.items()
               if heard(clips[k]["file"])[-len(want):] != want}
        if not bad:
            return clips
        print(f"  retake {sorted(bad)} (attempt {attempt + 1})")
        clips.update(_synth(lang, bad, tag))
    left = [k for k, want in expect.items()
            if heard(clips[k]["file"])[-len(want):] != want]
    if left:
        raise SystemExit(f"{tag}: {left} still unintelligible after {tries}")
    return clips


_DIGIT = {w: str(i) for i, w in enumerate(NUM["de"])}
_DIGIT.update({w: str(i) for i, w in enumerate(NUM["en"])})
_DIGIT.update({"zero": "0", "nought": "0"})


def build(brand, data: dict, match: float, outro: float, reveal: float,
          fps: int) -> Track:
    """Synthesize every line for one video and work out how long each segment
    has to be to hold it."""
    lang = brand.lang
    tmpl = LINES[lang]
    lines = {}
    for i, fx in enumerate(data["fixtures"], 1):
        lines[f"m{i}"] = tmpl["match"].format(
            home=say(fx["home_short"], lang), away=say(fx["away_short"], lang))
        lines[f"t{i}"] = tmpl["tip"].format(
            score=score_words(fx["picks"][brand.key]["score"], lang))
    lines["outro"] = tmpl["outro"]

    tag = f"{brand.key}-{data['slug']}"
    clips = _synth(lang, lines, tag)
    # A scoreline nobody can hear is the one defect this format cannot absorb,
    # so every tip line is listened to before it is used.
    expect = {f"t{i}": list(fx["picks"][brand.key]["score"].replace(":", ""))
              for i, fx in enumerate(data["fixtures"], 1)}
    clips = confirm(lang, lines, clips, expect, tag)

    segments, offsets, at = [], {}, 0        # `at` counts FRAMES, not seconds
    for i in range(1, len(data["fixtures"]) + 1):
        m, t = clips[f"m{i}"]["dur"], clips[f"t{i}"]["dur"]
        # the tip is spoken at the reveal, or after the team line - never over it
        t_at = max(reveal + 0.12, LEAD + m + GAP)
        seg = math.ceil(max(match, t_at + t + TAIL) * fps)
        offsets[f"m{i}"] = at / fps + LEAD
        offsets[f"t{i}"] = at / fps + t_at
        segments.append(seg)
        at += seg
    o = clips["outro"]["dur"]
    offsets["outro"] = at / fps + 0.25
    return Track(lang, clips, segments,
                 math.ceil(max(outro, 0.25 + o + 0.55) * fps), offsets, fps,
                 lines)
