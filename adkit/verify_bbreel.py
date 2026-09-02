#!/usr/bin/env python3
"""Verify a bet builder reel by MEASURING THE ENCODED FILE.

    python3 verify_bbreel.py                    # every reel that exists
    python3 verify_bbreel.py --selftest

Nothing here reads bbreel.py's intentions. The manifest says what should be
true; the mp4 is opened and asked whether it is. Five things:

1. the picture is the length the plan says, to the frame;
2. the audio hits land on the picture's hits. This is the whole claim of a
    beat-cut edit and it is the one thing that cannot be checked by looking at
    the code, because ffmpeg muxes two streams that were produced separately;
3. EVERY CUT THE EDIT PLANNED IS VISIBLE, ON ITS BEAT. Only that direction -
   "and nothing else changes" is a claim about the footage, not the edit, and
   it is not separable: see the comment on the check itself;
4. no rung of the progress bar shows its leg before that leg has been shown.
   Measured on PIXELS, in the rung's own rectangle, not on the plan - a rung
   that lights early is invisible to every other check here;
5. the unlit rung does not contain readable text. This is checked because the
   previous version of this format failed exactly here: the unlit state was
   the finished state behind a blur, which reads perfectly well, and every
   automated check passed while the bar gave away its own reveal.

`--selftest` slides the audio and re-runs, because a check that cannot fail is
worth less than no check.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import wave

import numpy as np

import bbreel as R

TMP = R.SCRATCH / "bbcheck"


def _audio(mp4: pathlib.Path) -> tuple[np.ndarray, int]:
    TMP.mkdir(parents=True, exist_ok=True)
    wav = TMP / (mp4.stem + ".wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4),
                    "-ac", "1", "-ar", "22050", str(wav)], check=True)
    with wave.open(str(wav)) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16)
    return x.astype(np.float32) / 32768, sr


def _onsets(x: np.ndarray, sr: int, band=(30, 160)) -> np.ndarray:
    """Times of the low-frequency impacts, from an energy envelope.

    Band limited on purpose: the bed is full of hats and claps, and what has
    to line up with the picture is the IMPACT, which is the only thing down
    here with that much energy.
    """
    n, h = 1024, 256
    fr = np.stack([x[i:i + n] * np.hanning(n)
                   for i in range(0, len(x) - n, h)])
    S = np.abs(np.fft.rfft(fr, axis=1))
    f = np.fft.rfftfreq(n, 1 / sr)
    m = (f >= band[0]) & (f < band[1])
    e = S[:, m].sum(1)
    d = np.maximum(0, np.diff(e))
    thr = d.mean() + 2.6 * d.std()
    pk = [i for i in range(1, len(d) - 1)
          if d[i] > thr and d[i] >= d[i - 1] and d[i] > d[i + 1]]
    return np.array(pk) * h / sr


def _frames(mp4: pathlib.Path, w: int = 216, h: int = 384) -> np.ndarray:
    """Every frame, small and grey. Small because nothing measured here needs
    resolution and 624 full frames is 3.9 GB."""
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(mp4), "-vf",
         f"scale={w}:{h},format=gray", "-f", "rawvideo", "-pix_fmt", "gray",
         "-"], capture_output=True)
    a = np.frombuffer(p.stdout, np.uint8)
    return a[:len(a) // (w * h) * w * h].reshape(-1, h, w).astype(np.float32)


def _edges(a: np.ndarray) -> float:
    """How much structure is in this patch. Text has edges; two flat bars and
    a blank panel do not."""
    gx = np.abs(np.diff(a, axis=-1)).mean()
    gy = np.abs(np.diff(a, axis=-2)).mean()
    return float(gx + gy)


def check(mp4: pathlib.Path, man: pathlib.Path,
          audio_shift: float = 0.0) -> list[str]:
    plan = json.loads(man.read_text(encoding="utf-8"))
    fps, fpb = plan["fps"], plan["fpb"]
    beat = fpb / fps
    fails: list[str] = []

    st = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-show_entries",
         "stream=codec_type,nb_read_frames", "-of", "json", str(mp4)],
        capture_output=True, text=True).stdout)["streams"]
    if not [s for s in st if s["codec_type"] == "audio"]:
        return [f"{mp4.name}: no audio stream"]
    got = int([s for s in st if s["codec_type"] == "video"][0]["nb_read_frames"])
    if got != plan["frames"]:
        fails.append(f"{mp4.name}: {got} frames, planned {plan['frames']}")

    # --- 2. the hits are where the picture says --------------------------
    x, sr = _audio(mp4)
    on = _onsets(x, sr) - audio_shift
    for hb in plan["hits"]:
        want = hb * beat
        if not len(on):
            fails.append(f"{mp4.name}: no impacts found in the audio at all")
            break
        d = float(np.min(np.abs(on - want)))
        if d > 2.5 / fps:
            fails.append(f"{mp4.name}: the hit planned for beat {hb} "
                         f"({want:.2f}s) has no impact within "
                         f"{d * 1000:.0f} ms in the muxed audio")

    fr = _frames(mp4)
    if len(fr) < plan["frames"]:
        fails.append(f"{mp4.name}: only decoded {len(fr)} of "
                     f"{plan['frames']} frames")
        return fails

    # --- 3. every planned cut is visible, on its beat ---------------------
    #
    # This asserts one direction only, and the missing direction is deliberate.
    # "Nothing changes except on a beat" is not a property of the edit - it is
    # a property of the FOOTAGE, which contains its own cuts and its own fast
    # motion. Measured on this file: a real edit cut scores 38.8% of pixels
    # changed and a player crossing frame mid-shot scores 37.5%, so the two
    # are not separable by any threshold. Asserting it anyway would have meant
    # tuning a number until the b-roll stopped complaining, which is how a
    # check ends up measuring nothing. What IS the edit's own claim is that
    # each cut it planned actually happens, on the beat it planned.
    diff = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    med = float(np.median(diff))
    missed = []
    for c in plan["cuts"]:
        f0 = c * fpb
        if f0 < 1 or f0 >= len(diff):
            continue
        # the strongest change within a frame either side, so a cut landing on
        # a frame boundary is not scored as absent
        local = diff[max(0, f0 - 2):f0 + 2].max()
        if local < med * 2.0:
            missed.append(c)
    if missed:
        fails.append(f"{mp4.name}: no picture change at beat(s) {missed} "
                     f"where a cut was planned")

    # --- 4/5. the ladder ---------------------------------------------------
    sy, sx = fr.shape[1] / R.H, fr.shape[2] / R.W
    for i, rb in enumerate(plan["rungs"]):
        y0 = int((R.LAD_Y + i * R.LAD_STEP) * sy)
        y1 = int((R.LAD_Y + i * R.LAD_STEP + R.LAD_H) * sy)
        # the text half of the rung; the icon is drawn in both states
        x0 = int((R.LAD_X + 110) * sx)
        x1 = int((R.LAD_X + R.LAD_W) * sx)
        lit = int(rb * fpb)
        # a beat before it lights, and a beat after it has settled
        before = max(int(9 * fpb), lit - fpb)
        after = min(plan["frames"] - 1, lit + fpb)
        e_before = _edges(fr[before, y0:y1, x0:x1])
        e_after = _edges(fr[after, y0:y1, x0:x1])
        if e_before > e_after * 0.55:
            fails.append(
                f"{mp4.name}: rung {i + 1} already has as much detail at "
                f"frame {before} ({e_before:.2f}) as it does once lit at "
                f"{after} ({e_after:.2f}) - the unlit state is showing its "
                f"leg before the reel does")
        if e_after < e_before * 1.6:
            fails.append(f"{mp4.name}: rung {i + 1} barely changes when it "
                         f"lights ({e_before:.2f} -> {e_after:.2f})")

    # --- the caption band is never empty while a caption is up -------------
    cy0, cy1 = int((R.CAP_Y - 150) * sy), int((R.CAP_Y + 190) * sy)
    for c in plan["caps"]:
        mid = int(((c["at"] + c["off"]) / 2) * fpb)
        if mid >= plan["frames"]:
            continue
        if _edges(fr[mid, cy0:cy1, :]) < 1.0:
            fails.append(f"{mp4.name}: nothing drawn in the caption band at "
                         f"frame {mid}, where {c['text']!r} should be")

    print(f"  {mp4.name:<46} {got:>4}f {got / fps:>5.1f}s  "
          f"{len(plan['caps'])} captions, "
          f"{len(plan['cuts']) - len(missed)}/{len(plan['cuts'])} cuts, "
          f"{len(fails)} problem(s)")
    return fails


def pairs() -> list[tuple[pathlib.Path, pathlib.Path]]:
    out = []
    for mp4 in sorted(R.OUT.glob("*.mp4")):
        brand, _, slug = mp4.stem.partition("-bb-")
        man = R.OUT / "vo" / f"{brand}-{slug}.json"
        if man.exists():
            out.append((mp4, man))
    return out


def selftest() -> int:
    """Slide the audio 150 ms late. The hit check has to notice."""
    ps = pairs()
    if not ps:
        raise SystemExit("nothing to self-test")
    mp4, man = ps[0]
    TMP.mkdir(parents=True, exist_ok=True)
    bad = TMP / ("SELFTEST-" + mp4.name)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4),
                    "-filter_complex", "[0:a]adelay=150|150[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "160k", str(bad)], check=True)
    n = len(check(bad, man))
    print(f"  selftest on a 150 ms late track: {n} complaint(s)"
          + ("" if n else "   <-- THE CHECK IS BLIND"))
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(0 if selftest() else 1)
    bad = []
    for mp4, man in pairs():
        bad += check(mp4, man)
    print(f"\nFAILURES: {len(bad)}")
    for f in bad:
        print("  !!", f)
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
