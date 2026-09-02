#!/usr/bin/env python3
"""Bet builder picks, read from tippsarena.com itself.

    ./fetch_bb.sh                      # refresh data/bb-raw.json off the site
    python3 bbtips.py                  # what every upcoming fixture would say

WHY THIS READS HIS SITE INSTEAD OF DERIVING ITS OWN. The reel's whole job is to
send someone to the page for that fixture. If the video says "Ueber 2.5 Tore,
80%" and the page says 65%, the person who clicked is the one who finds out.
So the legs, the percentages and the confidence all come out of `ta_markets`,
the same post meta the page renders from - one source, and a mismatch is not
possible rather than merely unlikely.

THE LEG LABEL IS PARSED, NOT PATTERN-MATCHED LOOSELY. Every label on the site
falls into one of eight shapes, checked across all 233 fixtures in the export:

    Über/Unter N Tore | ... N Karten | ... N Ecken | ... N Schüsse aufs Tor
    Beide Teams treffen - Ja/Nein
    Doppelte Chance X2 / 1X
    Sieg <club>
    Voraussichtliches Ergebnis N:N

Anything that does not parse is DROPPED rather than guessed at, and drop() says
so out loud. A leg the renderer cannot pronounce would otherwise reach the
voice as digits and come back as "Ueber zwei Punkt fuenf Tore" - or reach the
ladder as a raw string and be drawn in a language nobody speaks.

`Voraussichtliches Ergebnis` is deliberately NOT usable as a reel leg. It is a
correct score, which is the pick type he told me to stop making videos about.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
RAW = DATA / "bb-raw.json"
CRESTS = DATA / "img" / "bb"

#: Combos worth cutting a reel from, best first. "Ergebnis-Prognose" is a
#: correct score and never appears here.
COMBOS = ("Sicherheits-Kombi", "Top-Tipp", "Tor-Kombi", "Action-Kombi",
          "Ergebnis-Kombi")

# --------------------------------------------------------------- leg language
#: How a number is read out. German decimals are said "Komma".
#:
#: THESE KEEP THEIR UMLAUTS, and that is a fix rather than an oversight.
#: narrate._plain flattens ü to "ue" before synthesis, which is right for the
#: English voice - it cannot read an umlaut at all. Fed to the GERMAN voice the
#: same spelling is actively wrong, measured over six takes of each:
#:
#:     "Über zwei Komma fünf Tore"   -> "über 2,5 Tore"          6/6 clean
#:     "Ueber zwei Komma fuenf Tore" -> "ui über 2,5 Tore"       6/6 with a
#:                                       spurious leading syllable
#:     "Schüsse aufs Tor"            -> "Schüsse aufs Tor"
#:     "Schuesse aufs Tor"           -> "Schuhe ist aufs Tor"    every take
#:
#: So German text goes to the German voice as German is written.
DE_N = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben",
        "acht", "neun", "zehn", "elf", "zwölf"]
EN_N = ["zero", "one", "two", "three", "four", "five", "six", "seven",
        "eight", "nine", "ten", "eleven", "twelve"]


def _num_say(txt: str, lang: str) -> str:
    """"2.5" -> "zwei Komma fuenf" / "two point five"; "3" -> "drei"."""
    whole, _, frac = txt.replace(",", ".").partition(".")
    n = DE_N if lang == "de" else EN_N
    w = n[int(whole)] if whole.isdigit() and int(whole) < len(n) else whole
    if not frac:
        return w
    f = n[int(frac)] if frac.isdigit() and int(frac) < len(n) else frac
    return f"{w} Komma {f}" if lang == "de" else f"{w} point {f}"


#: (regex on the German label) -> everything needed to say and draw it.
#: `de`/`en` are (display, spoken) templates; {n} is the line, {t} the club.
#: `icon` names one of the glyphs bbdraw knows how to draw.
SHAPES = [
    (re.compile(r"^(Über|Unter) ([\d.,]+) Tore$"), "goal", {
        "de": ("{ud} {n} TORE", "{ud_say} {n_say} Tore"),
        "en": ("{ud_en} {n} GOALS", "{ud_en_say} {n_say} goals")}),
    (re.compile(r"^(Über|Unter) ([\d.,]+) Karten$"), "card", {
        "de": ("{ud} {n} KARTEN", "{ud_say} {n_say} Karten"),
        "en": ("{ud_en} {n} CARDS", "{ud_en_say} {n_say} cards")}),
    (re.compile(r"^(Über|Unter) ([\d.,]+) Ecken$"), "corner", {
        "de": ("{ud} {n} ECKEN", "{ud_say} {n_say} Ecken"),
        "en": ("{ud_en} {n} CORNERS", "{ud_en_say} {n_say} corners")}),
    (re.compile(r"^(Über|Unter) ([\d.,]+) Schüsse aufs Tor$"), "shot", {
        "de": ("{ud} {n} SCHÜSSE AUFS TOR",
               "{ud_say} {n_say} Schüsse aufs Tor"),
        "en": ("{ud_en} {n} SHOTS ON TARGET",
               "{ud_en_say} {n_say} shots on target")}),
]

#: The legs with no number in them. Same two forms, no template filling.
FIXED = {
    "Beide Teams treffen - Ja": ("btts", ("BEIDE TEAMS TREFFEN",
                                          "Beide Teams treffen"),
                                 ("BOTH TEAMS TO SCORE",
                                  "Both teams to score")),
    "Beide Teams treffen - Nein": ("btts", ("KEIN BEIDE-TEAMS-TREFFEN",
                                            "Beide Teams treffen. Nein"),
                                   ("NO BOTH TEAMS TO SCORE",
                                    "Both teams to score. No")),
}

DC = re.compile(r"^Doppelte Chance (X2|1X|12)$")
WIN = re.compile(r"^Sieg (.+)$")


class Leg:
    """One line of a bet builder: what it says, what it draws, how sure it is.

    `chunks` is what makes the caption land on the beat - (drawn, spoken)
    pairs, because "2.5" is one thing on screen and three words in the mouth.
    """

    def __init__(self, disp: str, say: str, icon: str, pct: int | None,
                 hero: list[str] | None = None):
        self.disp, self.say, self.icon, self.pct = disp, say, icon, pct
        #: How the leg is broken across the big centre captions. NOT one word
        #: per card: splitting "DOPPELTE CHANCE 1X" that way put a card on
        #: screen reading only "1X", which is not a bet, not a sentence and not
        #: anything a viewer can act on. The break is at the meaning - the
        #: line and its number, then what is being counted.
        self.hero = [h for h in (hero or [disp]) if h.strip()]

    def __repr__(self) -> str:
        return f"<Leg {self.disp!r} {self.pct}%>"


def parse_leg(label: str, pct: int | None, lang: str) -> Leg | None:
    """One site label -> a Leg, or None if this reel cannot say it."""
    label = label.strip()
    for rx, icon, forms in SHAPES:
        m = rx.match(label)
        if not m:
            continue
        ud, n = m.group(1), m.group(2)
        f = forms[lang]
        kw = {"n": n, "n_say": _num_say(n, lang),
              "ud": ud.upper(), "ud_say": "Über" if ud == "Über" else "Unter",
              "ud_en": "OVER" if ud == "Über" else "UNDER",
              "ud_en_say": "over" if ud == "Über" else "under"}
        disp = f[0].format(**kw)
        w = disp.split()
        # "ÜBER 7.5" then "SCHÜSSE AUFS TOR" - the line, then the thing.
        return Leg(disp, f[1].format(**kw), icon, pct,
                   [" ".join(w[:2]), " ".join(w[2:])])

    if label in FIXED:
        icon, de, en = FIXED[label]
        disp, say = de if lang == "de" else en
        w = disp.split()
        return Leg(disp, say, icon, pct,
                   [" ".join(w[:2]), " ".join(w[2:])] if len(w) > 2 else [disp])

    m = DC.match(label)
    if m:
        code = m.group(1)
        # "X2" is read out as a code, not as a word: the German voice says
        # "iks zwei", which is exactly how a punter reads it off a slip.
        code_say = {"X2": "iks zwei", "1X": "eins iks", "12": "eins zwei"}
        code_en = {"X2": "ex two", "1X": "one ex", "12": "one two"}
        if lang == "de":
            return Leg(f"DOPPELTE CHANCE {code}",
                       f"Doppelte Chance {code_say[code]}", "shield", pct,
                       ["DOPPELTE CHANCE", code])
        return Leg(f"DOUBLE CHANCE {code}",
                   f"Double chance {code_en[code]}", "shield", pct,
                   ["DOUBLE CHANCE", code])

    m = WIN.match(label)
    if m:
        name = m.group(1)
        if lang == "de":
            return Leg(f"SIEG {name.upper()}", f"Sieg {club(name, 'de')}",
                       "shield", pct)
        return Leg(f"{name.upper()} TO WIN", f"{club(name, 'en')} to win",
                   "shield", pct)
    return None


# ------------------------------------------------------------------- fixtures
class Fixture:
    def __init__(self, rec: dict, combo: dict, legs: list[Leg]):
        i = rec["info"]
        self.id = rec["id"]
        self.url = rec["url"]
        self.home, self.away = i["home"], i["away"]
        self.league = i["league"]
        self.kickoff = dt.datetime.fromisoformat(i["kickoff"])
        self.home_logo, self.away_logo = i["home_logo"], i["away_logo"]
        self.title = combo["title"]
        self.conf = combo.get("conf_pct")
        self.conf_word = combo.get("conf") or ""
        self.legs = legs

    @property
    def slug(self) -> str:
        return re.sub(r"[^a-z0-9]+", "-",
                      f"{self.home}-{self.away}".lower()).strip("-")

    def __repr__(self) -> str:
        return (f"<{self.home} v {self.away} {self.title} "
                f"{self.conf}% {len(self.legs)} legs>")


def _short(name: str) -> str:
    """The club as a fan writes it on a graphic."""
    import fetch_tips as F
    return F.SHORT.get(name, name)


def club(name: str, lang: str) -> str:
    """The club as the voice should read it.

    English keeps narrate.say in full - it both maps ("Köln" -> "Cologne") and
    flattens accents the English voice genuinely cannot read. German keeps the
    MAP and drops the FLATTENING, for the reason recorded on DE_N: fed
    "Osnabrueck" the German voice says "Osnab Ruhig"; fed "Osnabrück" it says
    Osnabrück.
    """
    import narrate as N
    if lang == "en":
        return N.say(name, "en")
    return N._SAY["de"].get(N._key(name)) or name


def load(lang: str = "de", upcoming: bool = True, min_legs: int = 3,
         verbose: bool = False) -> list[Fixture]:
    """Every fixture that has a combo this reel can actually say, best first.

    `upcoming` keeps only fixtures that have not kicked off. A reel published
    for a match that is already 40 minutes old is not a tip, and the site's
    own export is a snapshot that reaches back weeks.
    """
    if not RAW.exists():
        raise SystemExit(f"{RAW} missing - run ./fetch_bb.sh")
    now = dt.datetime.now(dt.timezone.utc)
    out = []
    for rec in json.loads(RAW.read_text(encoding="utf-8")):
        ko = dt.datetime.fromisoformat(rec["info"]["kickoff"])
        if upcoming and ko <= now:
            continue
        for want in COMBOS:
            combo = next((c for c in (rec["mk"].get("betbuilder") or [])
                          if c.get("title") == want), None)
            if not combo or not combo.get("conf_pct"):
                continue
            legs, dropped = [], []
            for p in combo.get("picks") or []:
                leg = parse_leg(p.get("label", ""), p.get("pct"), lang)
                (legs if leg else dropped).append(leg or p.get("label"))
            if verbose and dropped:
                print(f"  dropped from {rec['info']['home']}: {dropped}")
            if len(legs) >= min_legs:
                fx = Fixture(rec, combo, legs[:3])
                fx.home_short, fx.away_short = _short(fx.home), _short(fx.away)
                out.append(fx)
                break
    out.sort(key=lambda f: (-(f.conf or 0), f.kickoff))
    return out


def crest(url: str) -> pathlib.Path | None:
    """The club badge, cached on disk. A missing badge is not fatal - the card
    falls back to a blank disc rather than the render dying at frame 300."""
    CRESTS.mkdir(parents=True, exist_ok=True)
    p = CRESTS / (url.rstrip("/").split("/")[-1] or "x.png")
    if p.exists() and p.stat().st_size > 200:
        return p
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            p.write_bytes(r.read())
    except Exception as e:                                # noqa: BLE001
        print(f"  !! no crest {url}: {e}")
        return None
    return p if p.stat().st_size > 200 else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="de", choices=["de", "en"])
    ap.add_argument("--all", action="store_true",
                    help="include fixtures that have already kicked off")
    a = ap.parse_args()
    fx = load(a.lang, upcoming=not a.all, verbose=True)
    print(f"\n{len(fx)} fixture(s) a reel could be cut from\n")
    for f in fx[:25]:
        print(f"{f.kickoff:%d %b %H:%M}  {f.league[:24]:<24} "
              f"{f.home_short} - {f.away_short}")
        print(f"    {f.title} - {f.conf}%")
        for g in f.legs:
            print(f"      [{g.icon:<6}] {g.pct}%  {g.disp:<34} | {g.say}")


if __name__ == "__main__":
    main()
