#!/usr/bin/env python3
"""Bundle the six prediction videos per brand with a note that says where the
scorelines came from and which fixtures had no market.

One readme per brand, in that brand's language: TippsArena reads German,
LuxTipps reads English, same as the videos now do. Each zip carries only its
own brand's tips - shipping both tables in both zips was how the same document
ended up in front of two different audiences.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import zoneinfo
import pathlib
import re
import shutil
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out" / "tips"
DATA = ROOT / "data"
STAGE = pathlib.Path("/tmp/claude-1004/-home-freelancer/"
                     "9dbe74e0-4297-4b96-ba61-8a7c42919c50/scratchpad/tipszip")
ALL = [(2, "champions-league"), (39, "premier-league"), (78, "bundesliga"),
       (79, "bundesliga-2"), (140, "la-liga"), (135, "serie-a"),
       (61, "ligue-1"), (94, "primeira-liga"), (88, "eredivisie")]
#: `python3 make_tips_zip.py 2` packs one competition into its own zip. Without
#: an argument it packs the six weekend leagues, which is the September set.
#: The zip is NAMED after the selection - dropping four Champions League files
#: into a zip still called prognose-videos-tippsarena.zip is how he ends up
#: posting last week's Bundesliga.
_want = [int(a) for a in sys.argv[1:]]
_missing = [x for x in _want if x not in {a for a, _ in ALL}]
if _missing:
    sys.exit(f"no such league in ALL: {_missing} - add it, do not skip it")
LEAGUES = [x for x in ALL if x[0] in _want] if _want else ALL[1:7]
#: One competition -> named after it. An explicit multi-league selection ->
#: "-top-leagues", because the September six and this seven are DIFFERENT packs
#: and a second file called prognose-videos-tippsarena.zip in his downloads
#: folder is indistinguishable from the first.
TAG = ("-" + LEAGUES[0][1]) if len(LEAGUES) == 1 else \
      ("-top-leagues" if _want else "")
TZ = zoneinfo.ZoneInfo("Europe/Berlin")

SPLIT_DE = """Dieser Spieltag laeuft ueber mehrere Abende, deshalb bekommst du BEIDE
Schnitte: einmal der komplette Spieltag am Stueck, und dazu ein Video pro
Spieltag-Abend. Der lange Schnitt ist fuer TikTok und den Feed, die kurzen
sind fuer Shorts (Grenze 60 Sekunden) und dafuer, morgens genau die Spiele zu
posten, die am selben Abend laufen.

Die Ergebnisse sind in beiden Schnitten dieselben - die Auswahl laeuft ueber
den ganzen Spieltag, nicht pro Abend. Sonst wuerde derselbe Tipp im langen
und im kurzen Video unterschiedlich stehen.
"""
PLAIN_DE = """Ein Video pro Liga, ein kompletter Spieltag darin, 35 bis 40 Sekunden. Damit
bleibt jedes Video unter der 60-Sekunden-Grenze von YouTube Shorts, es
braucht hier also keine Aufteilung nach Spieltagen wie bei der Champions
League.
"""
SPLIT_EN = """This matchday runs over several evenings, so you get BOTH cuts: the whole
matchday in one go, plus one video per night. The long cut is for TikTok and
the feed; the short ones are for Shorts (60-second ceiling) and for posting in
the morning exactly the matches played that same evening.

The scorelines are identical in both cuts - the selection runs across the
whole matchday, not per night. Otherwise the same fixture would carry a
different tip in the long video and in the short one.
"""
PLAIN_EN = """One video per league, one full matchday in each, 35 to 40 seconds. That keeps
every file under the 60-second YouTube Shorts ceiling, so these need no
per-night split the way the Champions League did.
"""

BRANDS = {
    "tippsarena": {"lang": "de", "file": "LIESMICH.txt",
                   "look": "dunkel/orange, deutsch"},
    "luxtipps": {"lang": "en", "file": "README.txt",
                 "look": "light/cream/gold, English"},
}


def _table(brand: str, lang: str) -> tuple[list[str], list[float]]:
    rows, quotes = [], []
    head = ("Spiel", "Tipp", "Anstoss") if lang == "de" else \
           ("Match", "Tip", "Kick-off")
    day = "Spieltag" if lang == "de" else "Matchday"
    for lid, _slug in LEAGUES:
        d = json.loads((DATA / f"tips-{lid}.json").read_text(encoding="utf-8"))
        rows.append(f"\n{d['league']} - {day} {d['round'].rsplit('-', 1)[-1].strip()}")
        rows.append(f"{head[0]:<38}{head[1]:<12}{head[2]}")
        for f in d["fixtures"]:
            tip = f.get("picks", {}).get(brand)
            if not tip:
                continue
            quotes.append(tip["odds"])
            ko = dt.datetime.fromisoformat(f["kickoff"]).astimezone(TZ)
            rows.append(f"{f['home_short']} - {f['away_short']:<{max(0, 36 - len(f['home_short']))}}"
                        f"{tip['score']:<12}{ko:%d.%m. %H:%M}")
    return rows, quotes


def _readme_de(rows, quotes, leagues, missing, files, split_de, split_en) -> str:
    lo, hi = min(quotes), max(quotes)
    avg = sum(quotes) / len(quotes)
    band = (f"  Niedrigste: {lo:.2f}   Hoechste: {hi:.2f}   "
            f"Schnitt: {avg:.2f}").replace(".", ",")
    return f"""PROGNOSE-VIDEOS TIPPSARENA
Erstellt am {dt.date.today().strftime('%d.%m.%Y')}

{len(files)} Videos, 1080 x 1920, 30 fps, H.264, OHNE Tonspur.
Ton legst du in der App drauf - dann greift der Algorithmus, und ich
schicke dir keine fremde Musik mit ins Werbekonto.

WIE DAS PAKET AUFGEBAUT IST
{split_de}
Unveraendert seit dem letzten Paket: kein Text unten drunter, kein Bot-Name,
keine Quote im Bild, keine Startseite, Anstosszeiten in deutscher Ortszeit.

WOHER DIE ERGEBNISSE KOMMEN
Nicht von mir. Fuer jedes Spiel wird der EXACT-SCORE-MARKT der Buchmacher
aus der API gelesen. Jede Quote wird in eine Wahrscheinlichkeit umgerechnet
und pro Buchmacher normiert (das nimmt die Marge raus), danach ueber alle
Buchmacher gemittelt.

Gewaehlt wird NICHT das wahrscheinlichste Ergebnis - das ist auch bei einem
klaren Favoriten nur eine 8-12-Prozent-Chance und ergibt eine Reihe fast
identischer 1:2. Gewaehlt wird aus Ergebnissen, die zwischen 5,00 und 20,00
notiert sind, und die Zielzone wandert ueber den Spieltag. Im Bild steht die
Quote nicht mehr, sie steuert nur noch die Auswahl.
{band}

Jedes Ergebnis ist eine Linie, die ein Buchmacher wirklich anbietet.
Erfunden ist nichts. TippsArena und LuxTipps bekommen fuer dasselbe Spiel
nie dasselbe Ergebnis - das ist im Code verboten.

Im Video steht "PROGNOSE", nicht "FULL TIME". Die Videos laufen VOR dem
Anpfiff; wer eine Prognose fuer ein Ergebnis haelt, haelt den Account fuer
einen Luegner, sobald der echte Endstand kommt.

DIE DATEIEN
{chr(10).join(files)}

SPIELTAGE IN DIESEM PAKET
{chr(10).join(leagues)}

FEHLENDE SPIELE
Fuer diese Partien gibt es in der API noch keinen Vorab-Markt (Quoten
oeffnen meist 2-3 Tage vor Anpfiff). Sie sind nicht im Video:
{missing}

  Sag Bescheid, sobald du sie brauchst - Daten neu ziehen und alle Videos
  neu rendern dauert zusammen etwa 15 Minuten.

ALLE TIPPS IM KLARTEXT
{chr(10).join(rows)}
"""


def _readme_en(rows, quotes, leagues, missing, files, split_de, split_en) -> str:
    lo, hi = min(quotes), max(quotes)
    avg = sum(quotes) / len(quotes)
    return f"""PREDICTION VIDEOS - LUXTIPPS
Built {dt.date.today().strftime('%d.%m.%Y')}

{len(files)} videos, 1080 x 1920, 30 fps, H.264, NO audio track.
Add the sound in the app - that is what the algorithm rewards, and it keeps
somebody else's music out of your ad account.

HOW THE PACK IS PUT TOGETHER
{split_en}
Unchanged since the last pack: no text at the bottom, no bot name, no odds on
screen, no title card, English throughout, kick-off times in German local
time.

WHERE THE SCORELINES COME FROM
Not from me. For every match the bookmakers' EXACT SCORE market is read from
the API. Each price is converted to a probability and normalised per
bookmaker (that strips the margin out), then averaged across the books.

The pick is NOT the most likely score. Even with a clear favourite that is
only an 8-12% shot, and it produces a column of near-identical 1:2s. The pick
is drawn from the scorelines priced between 5.00 and 20.00, with the target
zone rotating down the matchday. The odds no longer appear on screen - they
only decide which line gets published.
  lowest {lo:.2f}   highest {hi:.2f}   average {avg:.2f}

Every scoreline is a line a bookmaker actually offers. Nothing is invented.
LuxTipps and TippsArena never carry the same score for the same match - that
is enforced in code, not left to chance.

The screen says PREDICTION, never FULL TIME. These go out BEFORE kick-off,
and a viewer who reads a prediction as a result will think the account lies
the moment the real score lands.

THE FILES
{chr(10).join(files)}

MATCHDAYS IN THIS PACK
{chr(10).join(leagues)}

MISSING MATCHES
These fixtures have no pre-match market in the API yet (odds usually open 2-3
days before kick-off), so they are not in the videos:
{missing}

  Say the word when you want them - refetching and re-rendering everything
  takes about 15 minutes.

EVERY TIP IN PLAIN TEXT
{chr(10).join(rows)}
"""


def main() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    leagues_de, leagues_en, missing_all = [], [], []
    for lid, slug in LEAGUES:
        d = json.loads((DATA / f"tips-{lid}.json").read_text(encoding="utf-8"))
        rnd = d["round"].rsplit("-", 1)[-1].strip()
        leagues_de.append(f"  {d['league']:<16} Spieltag {rnd:<3} "
                          f"{len(d['fixtures'])} von {d['round_size']} Spielen")
        leagues_en.append(f"  {d['league']:<16} Matchday {rnd:<3} "
                          f"{len(d['fixtures'])} of {d['round_size']} matches")
        for m in d["no_market"]:
            missing_all.append(f"  {d['league']}: {m}")
        # The whole round, plus every per-night cut that was rendered for it.
        # Globbing would also sweep up the -voice files, which are a different
        # deliverable and were never part of this pack.
        days = sorted({dt.datetime.fromisoformat(f["kickoff"]).astimezone(TZ)
                       .date() for f in d["fixtures"]})
        names = [f"{slug}"] + [f"{slug}-{day:%d-%m}" for day in days]
        for brand in BRANDS:
            dest = STAGE / brand
            dest.mkdir(parents=True, exist_ok=True)
            for nm in names:
                src = OUT / f"{brand}-prognosen-{nm}.mp4"
                if nm == slug or src.exists():
                    shutil.copy(src, dest / src.name)

    missing = "\n".join(missing_all) if missing_all else "  keine / none"
    for brand, meta in BRANDS.items():
        rows, quotes = _table(brand, meta["lang"])
        # Read the lengths off the staged files rather than recomputing them
        # from MATCH x fixtures: the note then describes the mp4s in the zip,
        # not the plan they were rendered from.
        files = []
        for f in sorted((STAGE / brand).glob("*.mp4")):
            n = json.loads(subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries",
                 "format=duration", "-of", "json", str(f)],
                capture_output=True, text=True).stdout)["format"]["duration"]
            files.append(f"  {f.name:<52}{float(n):>5.0f} s")
        # Only claim the per-night cuts when the pack actually has some. A
        # weekend league is 9-10 games in 36s and needs no split; describing
        # files that are not in the zip is the same defect as omitting ones
        # that are.
        has_split = any(re.search(r"-\d{2}-\d{2}\.mp4$", f.name)
                        for f in sorted((STAGE / brand).glob("*.mp4")))
        split_de = SPLIT_DE if has_split else PLAIN_DE
        split_en = SPLIT_EN if has_split else PLAIN_EN
        text = (_readme_de(rows, quotes, leagues_de, missing, files,
                           split_de, split_en) if meta["lang"] == "de"
                else _readme_en(rows, quotes, leagues_en, missing, files,
                                split_de, split_en))
        (STAGE / brand / meta["file"]).write_text(text, encoding="utf-8")
        out = ROOT / f"prognose-videos{TAG}-{brand}.zip"
        if out.exists():
            out.unlink()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:  # mp4 will not shrink
            for f in sorted((STAGE / brand).iterdir()):
                z.write(f, f.name)
        print(out.name, out.stat().st_size // 1024 // 1024, "MB")
        print(text)


if __name__ == "__main__":
    main()
