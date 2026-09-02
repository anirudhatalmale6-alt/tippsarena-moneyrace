"""Verify the narrated cut by LISTENING to the finished mp4.

Same rule as the picture checks: the deliverable is the encoded file, so the
audio is pulled back OUT of the mp4 and transcribed with whisper. Reading
narrate.py would only prove what I meant to say.

Four things have to hold, none of them visible in the source:

1. there is an audio stream, and the picture was not truncated to fit it;
2. every fixture's scoreline is actually spoken, in fixture order;
3. no tip is spoken BEFORE the score is on screen (segment start + REVEAL);
4. no line is still running when its segment cuts away.

The timings come from the manifest the render wrote, never from re-running
narrate: piper's duration predictor is stochastic, so a fresh synthesis
describes a track that was never muxed.

Whisper writes scorelines as digits ("2 zu 1") where piper was given words
("zwei zu eins"). Both spellings are accepted - that is the transcriber's
convention, not a defect in the audio.

    python3 verify_voice.py                 # every narrated file that exists
    python3 verify_voice.py tippsarena 78
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import narrate
import tips_video as T
from faster_whisper import WhisperModel

TMP = pathlib.Path("/tmp/claude-1004/-home-freelancer/"
                   "9dbe74e0-4297-4b96-ba61-8a7c42919c50/scratchpad/vo")
DIGIT = {"null": "0", "eins": "1", "zwei": "2", "drei": "3", "vier": "4",
         "fuenf": "5", "fünf": "5", "sechs": "6", "sieben": "7", "acht": "8",
         "neun": "9", "nil": "0", "one": "1", "two": "2", "three": "3",
         "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8",
         "nine": "9", "zero": "0", "nought": "0"}


def norm(w: str) -> str:
    w = "".join(c for c in w.lower() if c.isalnum())
    return DIGIT.get(w, w)


def check(brand_key: str, league_id: int, model: WhisperModel,
          mp4: pathlib.Path | None = None) -> list[str]:
    b = T.BRANDS[brand_key]
    data = json.loads((T.DATA / f"tips-{league_id}.json").read_text(encoding="utf-8"))
    fx = [f for f in data["fixtures"] if brand_key in f.get("picks", {})]
    mp4 = mp4 or T.OUT / f"{brand_key}-prognosen-{data['slug']}-voice.mp4"
    plan = json.loads((T.OUT / "vo" / f"{brand_key}-{data['slug']}.json")
                      .read_text(encoding="utf-8"))
    fails = []

    st = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-show_entries",
         "stream=codec_type,nb_read_frames", "-of", "json", str(mp4)],
        capture_output=True, text=True).stdout)["streams"]
    if not [s for s in st if s["codec_type"] == "audio"]:
        return [f"{mp4.name}: no audio stream"]
    want = sum(plan["segments"]) + plan["outro"]
    got = int([s for s in st if s["codec_type"] == "video"][0]["nb_read_frames"])
    if got != want:
        fails.append(f"{mp4.name}: {got} frames, planned {want} "
                     f"- the picture was cut to fit the track")

    starts, at = [], 0
    for s in plan["segments"]:
        starts.append(at / plan["fps"])
        at += s

    TMP.mkdir(parents=True, exist_ok=True)
    wav = TMP / f"{brand_key}-{data['slug']}.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4),
                    "-ac", "1", "-ar", "16000", str(wav)], check=True)
    segs, _ = model.transcribe(str(wav), language=plan["lang"],
                               word_timestamps=True)
    # Whisper is free to write the same utterance as "zwei zu eins", "2 zu 1"
    # or "2:1" - and it picks differently from one file to the next, which is
    # how a first version of this check reported nineteen scorelines "never
    # spoken" that are plainly audible. So the transcript is reduced to a
    # stream of DIGITS with timestamps, and the tip is looked up in that.
    digits = []
    for s in segs:
        for w in s.words:
            for c in norm(w.word):
                if c.isdigit():
                    digits.append((c, w.start, w.end))

    cursor = 0
    for i, f in enumerate(fx):
        sc = f["picks"][brand_key]["score"]
        toks = [sc.split(":")[0], sc.split(":")[1]]
        hit = next((j for j in range(cursor, len(digits) - 1)
                    if digits[j][0] == toks[0] and digits[j + 1][0] == toks[1]),
                   None)
        if hit is None:
            fails.append(f"{mp4.name}: match {i + 1} ({f['home_short']}) "
                         f"tip {sc!r} never spoken")
            continue
        t0, t1 = digits[hit][1], digits[hit + 1][2]
        reveal_at = starts[i] + T.REVEAL
        if t0 + 0.15 < reveal_at:
            fails.append(f"{mp4.name}: match {i + 1} tip spoken at {t0:.2f}s, "
                         f"before the score appears at {reveal_at:.2f}s")
        end = starts[i] + plan["segments"][i] / plan["fps"]
        if t1 > end:
            fails.append(f"{mp4.name}: match {i + 1} tip runs past its cut "
                         f"({t1:.2f} > {end:.2f})")
        cursor = hit + len(toks)
    print(f"  {mp4.name:<46} {got:>5}f {got / plan['fps']:>6.1f}s  "
          f"{len(fx)} tips heard in order, "
          f"{len(fails)} problem(s)")
    return fails


def selftest(brand_key: str, league_id: int, model: WhisperModel) -> int:
    """Does this check FIRE on a video that is actually wrong?

    A checker that reports all-clear because it can never match anything is
    worth less than no checker. So: take a good file, slide its audio 2.5 s
    late, and require the timing test to complain. Silence here means the
    green run above proved nothing.
    """
    d = json.loads((T.DATA / f"tips-{league_id}.json").read_text(encoding="utf-8"))
    src = T.OUT / f"{brand_key}-prognosen-{d['slug']}-voice.mp4"
    TMP.mkdir(parents=True, exist_ok=True)
    bad = TMP / f"SELFTEST-{brand_key}-{d['slug']}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
                    "-filter_complex", "[0:a]adelay=2500|2500[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "128k", str(bad)], check=True)
    fired = check(brand_key, league_id, model, mp4=bad)
    print(f"  selftest on a 2.5 s late track: {len(fired)} complaint(s)"
          + ("" if fired else "  <-- THE CHECK IS BLIND"))
    return len(fired)


def main() -> None:
    a = sys.argv[1:]
    if a and a[0] == "--selftest":
        model = WhisperModel("small", device="cpu", compute_type="int8")
        raise SystemExit(0 if selftest(a[1], int(a[2]), model) else 1)
    if len(a) == 2:
        pairs = [(a[0], int(a[1]))]
    else:
        pairs = []
        for bk in T.BRANDS:
            for lid in (39, 78, 79, 140, 135, 61):
                d = json.loads((T.DATA / f"tips-{lid}.json").read_text(encoding="utf-8"))
                if (T.OUT / "vo" / f"{bk}-{d['slug']}.json").exists():
                    pairs.append((bk, lid))
    model = WhisperModel("small", device="cpu", compute_type="int8")
    bad = []
    for bk, lid in pairs:
        bad += check(bk, lid, model)
    print("\nFAILURES:", len(bad))
    for f in bad:
        print("  !!", f)


if __name__ == "__main__":
    main()
