"""Verify a pick reel by LISTENING to the finished mp4.

The whole claim of this format is that the caption lands on the word. Reading
reel.py cannot test that - the caption times in the manifest are what the
renderer *intended*, and whether the audio that got muxed says those words at
those moments is a separate fact. So the audio is pulled back out of the
encoded file, transcribed with word timestamps, and every caption is looked up
in what was actually heard.

Four things have to hold:

1. the picture was not truncated to fit the track (frames == the plan);
2. most of the script is recognisable in the audio, so a file that matches
   nothing cannot pass by matching nothing;
3. every word the transcriber DID recognise is heard within TOL of the moment
   its caption is drawn - that is the sync claim;
4. no score is spoken before the card shows it.

A caption is not required to match word for word. Whisper writes "of the" for
a clearly spoken "for the"; treating that as a defect in the video would be
mistaking the transcriber's ear for the deliverable.

Timings come from the manifest the render wrote, never from re-running the
synthesiser: piper's duration predictor samples, so a fresh run describes a
soundtrack that was never muxed.

    python3 verify_reel.py                    # every reel that exists
    python3 verify_reel.py tippsarena 78
    python3 verify_reel.py --selftest tippsarena 78
"""
from __future__ import annotations

import difflib
import json
import pathlib
import subprocess
import sys

import reel as R
import tips_video as T
from faster_whisper import WhisperModel

TMP = R.SCRATCH / "reelcheck"
TOL = 0.40          # a caption more than this off the word reads as out of sync


def heard(mp4: pathlib.Path, lang: str, model) -> list[tuple[str, float, float]]:
    TMP.mkdir(parents=True, exist_ok=True)
    wav = TMP / (mp4.stem + ".wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4),
                    "-ac", "1", "-ar", "16000", str(wav)], check=True)
    segs, _ = model.transcribe(str(wav), language=lang, word_timestamps=True)
    return [(R._norm(w.word), float(w.start), float(w.end))
            for s in segs for w in s.words if R._norm(w.word)]


def check(brand_key: str, league_id: int, model,
          mp4: pathlib.Path | None = None) -> list[str]:
    data = json.loads((T.DATA / f"tips-{league_id}.json").read_text(encoding="utf-8"))
    slug = data["slug"]
    plan = json.loads((R.OUT / "vo" / f"{brand_key}-{slug}.json")
                      .read_text(encoding="utf-8"))
    mp4 = mp4 or R.OUT / f"{brand_key}-reel-{slug}.mp4"
    fails = []

    st = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-show_entries",
         "stream=codec_type,nb_read_frames", "-of", "json", str(mp4)],
        capture_output=True, text=True).stdout)["streams"]
    if not [s for s in st if s["codec_type"] == "audio"]:
        return [f"{mp4.name}: no audio stream"]
    want = sum(plan["frames"])
    got = int([s for s in st if s["codec_type"] == "video"][0]["nb_read_frames"])
    if got != want:
        fails.append(f"{mp4.name}: {got} frames, planned {want} "
                     f"- the picture was cut to fit the track")

    hyp = heard(mp4, plan["lang"], model)
    starts, at = [], 0
    for f in plan["frames"]:
        starts.append(at / plan["fps"])
        at += f

    # ONE alignment of the whole script against the whole transcript, rather
    # than hunting each caption separately. A caption is not required to match
    # word for word: whisper writes "of the" for a clearly spoken "for the",
    # and demanding an exact hit turns the transcriber's ear into a defect in
    # the video. What is required is that the words it DID recognise are heard
    # when the caption says they will be - and that it recognised most of them,
    # so an unrecognisable file cannot pass by matching nothing.
    ref = [(ci, R._norm(w), t0) for ci, c in enumerate(plan["caps"])
           for w, t0, _ in c["words"]]
    sm = difflib.SequenceMatcher(a=[r[1] for r in ref],
                                 b=[h[0] for h in hyp], autojunk=False)
    hits: dict[int, list[tuple[float, float]]] = {}
    worst, matched = 0.0, 0
    for i, j, n in sm.get_matching_blocks():
        for k in range(n):
            ci, _, want = ref[i + k]
            drift = hyp[j + k][1] - want
            worst = max(worst, abs(drift))
            matched += 1
            hits.setdefault(ci, []).append((hyp[j + k][1], drift))
            if abs(drift) > TOL:
                fails.append(f"{mp4.name}: caption {plan['caps'][ci]['text']!r}"
                             f" word {ref[i + k][1]!r} drawn at {want:.2f}s, "
                             f"spoken at {hyp[j + k][1]:.2f}s ({drift:+.2f}s)")
    share = matched / max(len(ref), 1)
    if share < 0.80:
        fails.append(f"{mp4.name}: only {share:.0%} of the script was "
                     f"recognisable in the audio - too little to judge sync")

    for ci, c in enumerate(plan["caps"]):
        rev = plan["reveals"][c["seg"]]
        if ":" not in c["text"] or rev is None or ci not in hits:
            continue
        spoken = min(t for t, _ in hits[ci])
        if spoken + 0.05 < rev:
            fails.append(f"{mp4.name}: {c['text']} spoken at {spoken:.2f}s, "
                         f"before the card shows it at {rev:.2f}s")

    print(f"  {mp4.name:<40} {got:>4}f {got / plan['fps']:>5.1f}s  "
          f"{len(plan['caps'])} captions, {share:.0%} of words heard, "
          f"worst drift {worst:.2f}s, {len(fails)} problem(s)")
    return fails


def selftest(brand_key: str, league_id: int, model) -> int:
    """Does this check FIRE on a file that is genuinely out of sync?

    A sync test that can never fail is worth less than no test. Slide the audio
    2.5 s late and require it to complain - if it stays quiet, the green run
    above proved nothing.
    """
    d = json.loads((T.DATA / f"tips-{league_id}.json").read_text(encoding="utf-8"))
    src = R.OUT / f"{brand_key}-reel-{d['slug']}.mp4"
    TMP.mkdir(parents=True, exist_ok=True)
    bad = TMP / f"SELFTEST-{brand_key}-{d['slug']}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
                    "-filter_complex", "[0:a]adelay=2500|2500[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "128k", str(bad)], check=True)
    fired = check(brand_key, league_id, model, mp4=bad)
    print(f"  selftest on a 2.5 s late track: {len(fired)} complaint(s)"
          + ("" if fired else "   <-- THE CHECK IS BLIND"))
    return len(fired)


def main() -> None:
    a = sys.argv[1:]
    model = WhisperModel("small", device="cpu", compute_type="int8")
    if a and a[0] == "--selftest":
        raise SystemExit(0 if selftest(a[1], int(a[2]), model) else 1)
    if len(a) == 2:
        pairs = [(a[0], int(a[1]))]
    else:
        pairs = []
        for bk in T.BRANDS:
            for lid in (39, 78, 79, 140, 135, 61):
                d = json.loads((T.DATA / f"tips-{lid}.json").read_text(encoding="utf-8"))
                if (R.OUT / "vo" / f"{bk}-{d['slug']}.json").exists():
                    pairs.append((bk, lid))
    bad = []
    for bk, lid in pairs:
        bad += check(bk, lid, model)
    print("\nFAILURES:", len(bad))
    for f in bad:
        print("  !!", f)


if __name__ == "__main__":
    main()
