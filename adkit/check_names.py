"""Does the voice actually say the club's name?

The SAY map in narrate.py is a list of guesses: "PSG" has to be expanded or it
comes out as three letters, "Mainz 05" has to be spelled "null fuenf" or the
German voice reads a year. Guesses are not measurements, and one of them was
wrong for weeks - the English entries were keyed "Koln" while the flattener
produces "Koeln", so LuxTipps said the German spelling out loud instead of
"Cologne" and nothing anywhere noticed.

So this measures it. Every club in the six leagues is synthesized inside the
real sentence template, the audio is transcribed back, and the club's own words
are compared with what the transcriber heard. Whisper is not a listener, but a
name it cannot recover from clean studio audio is a name a viewer will not
recover either - it is a lower bound, and a cheap one.

    python3 check_names.py            # both voices, all six leagues
    python3 check_names.py de
"""
from __future__ import annotations

import difflib
import json
import pathlib
import sys

import narrate as N
import reel as R
import tips_video as T
from faster_whisper import WhisperModel

#: Something whisper never mishears, so the tokens before it are unambiguously
#: the club being tested.
FOIL = {"de": ("gegen", "Dortmund"), "en": ("against", "Dortmund")}
FLOOR = 0.62


def clubs() -> list[str]:
    names = set()
    for lid in (39, 78, 79, 140, 135, 61):
        p = T.DATA / f"tips-{lid}.json"
        if not p.exists():
            continue
        for f in json.loads(p.read_text(encoding="utf-8"))["fixtures"]:
            names.add(f["home_short"])
            names.add(f["away_short"])
    return sorted(names)


def _score(heard: str, joiner: str, *targets: str) -> tuple[float, str]:
    cut = heard.lower().find(joiner)
    said = (heard[:cut] if cut > 0 else heard).strip()
    got = R._norm(said.replace(" ", ""))
    best = max(difflib.SequenceMatcher(a=got, b=R._norm(t.replace(" ", ""))).ratio()
               for t in targets)
    return best, said


def audit(lang: str, model) -> list[dict]:
    """Score every club twice: as the SAY map says it, and as it is written.

    Two numbers, not one. A respelling is only worth carrying if it measures
    better than the plain spelling - otherwise it is a guess that has quietly
    become a fact, and there is no way to tell the two apart later.
    """
    names = clubs()
    joiner, foil = FOIL[lang]
    lines = {}
    for i, n in enumerate(names):
        lines[f"m{i}"] = f"{N.say(n, lang)} {joiner} {foil}."
        lines[f"p{i}"] = f"{N._plain(n)} {joiner} {foil}."
    clips = N._synth(lang, lines, f"names-{lang}")

    rows = []
    for i, name in enumerate(names):
        out = {}
        for tag, spoken in (("map", N.say(name, lang)),
                            ("plain", N._plain(name))):
            segs, _ = model.transcribe(clips[f"{tag[0]}{i}"]["file"],
                                       language=lang)
            out[tag] = _score(" ".join(s.text for s in segs), joiner,
                              spoken, name)
        rows.append({"name": name, "spoken": N.say(name, lang),
                     "score": out["map"][0], "heard": out["map"][1],
                     "plain": out["plain"][0], "plain_heard": out["plain"][1]})
    return sorted(rows, key=lambda r: r["score"])


def main() -> None:
    langs = sys.argv[1:] or ["de", "en"]
    model = WhisperModel("small", device="cpu", compute_type="int8")
    bad = 0
    for lang in langs:
        rows = audit(lang, model)
        low = [r for r in rows if r["score"] < FLOOR]
        print(f"\n=== {lang}: {len(rows)} clubs, {len(low)} below {FLOOR}")
        for r in low:
            bad += 1
            print(f"  {r['score']:.2f}  {r['name']:<18} "
                  f"spoken {r['spoken']!r:<26} heard {r['heard']!r}")
        # A respelling that scores no better than the plain spelling is noise
        # in the map and should come back out.
        useless = [r for r in rows
                   if r["spoken"] != N._plain(r["name"])
                   and r["score"] <= r["plain"]]
        if useless:
            print(f"  -- {len(useless)} entr(ies) no better than plain:")
            for r in useless:
                print(f"     {r['name']:<18} {r['spoken']!r:<26} "
                      f"{r['score']:.2f} vs plain {r['plain']:.2f} "
                      f"({r['plain_heard']!r})")
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
