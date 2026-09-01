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
import zoneinfo
import pathlib
import shutil
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out" / "tips"
DATA = ROOT / "data"
STAGE = pathlib.Path("/tmp/claude-1004/-home-freelancer/"
                     "9dbe74e0-4297-4b96-ba61-8a7c42919c50/scratchpad/tipszip")
LEAGUES = [(39, "premier-league"), (78, "bundesliga"), (79, "bundesliga-2"),
           (140, "la-liga"), (135, "serie-a"), (61, "ligue-1")]
TZ = zoneinfo.ZoneInfo("Europe/Berlin")

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


def _readme_de(rows, quotes, leagues, missing) -> str:
    lo, hi = min(quotes), max(quotes)
    avg = sum(quotes) / len(quotes)
    band = (f"  Niedrigste: {lo:.2f}   Hoechste: {hi:.2f}   "
            f"Schnitt: {avg:.2f}").replace(".", ",")
    return f"""PROGNOSE-VIDEOS TIPPSARENA
Erstellt am {dt.date.today().strftime('%d.%m.%Y')}

6 Videos, 1080 x 1920, 30 fps, H.264, OHNE Tonspur.
Ton legst du in der App drauf - dann greift der Algorithmus, und ich
schicke dir keine fremde Musik mit ins Werbekonto.

WAS SICH GEAENDERT HAT
  - kein Text mehr unten drunter, auch kein Bot-Name
  - keine Quote mehr im Bild
  - keine Startseite mehr: das erste Spiel laeuft ab Bild eins
  - Anstosszeiten in deutscher Ortszeit

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


def _readme_en(rows, quotes, leagues, missing) -> str:
    lo, hi = min(quotes), max(quotes)
    avg = sum(quotes) / len(quotes)
    return f"""PREDICTION VIDEOS - LUXTIPPS
Built {dt.date.today().strftime('%d.%m.%Y')}

6 videos, 1080 x 1920, 30 fps, H.264, NO audio track.
Add the sound in the app - that is what the algorithm rewards, and it keeps
somebody else's music out of your ad account.

WHAT CHANGED
  - no text at the bottom any more, no bot name either
  - no odds on screen
  - no title card: the first match is on screen from frame one
  - English throughout, and a layout that shares nothing with TippsArena
  - kick-off times in German local time

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
        for brand in BRANDS:
            dest = STAGE / brand
            dest.mkdir(parents=True, exist_ok=True)
            src = OUT / f"{brand}-prognosen-{slug}.mp4"
            shutil.copy(src, dest / src.name)

    missing = "\n".join(missing_all) if missing_all else "  keine / none"
    for brand, meta in BRANDS.items():
        rows, quotes = _table(brand, meta["lang"])
        text = (_readme_de(rows, quotes, leagues_de, missing) if meta["lang"] == "de"
                else _readme_en(rows, quotes, leagues_en, missing))
        (STAGE / brand / meta["file"]).write_text(text, encoding="utf-8")
        out = ROOT / f"prognose-videos-{brand}.zip"
        if out.exists():
            out.unlink()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:  # mp4 will not shrink
            for f in sorted((STAGE / brand).iterdir()):
                z.write(f, f.name)
        print(out.name, out.stat().st_size // 1024 // 1024, "MB")
        print(text)


if __name__ == "__main__":
    main()
