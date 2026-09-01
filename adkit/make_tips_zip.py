#!/usr/bin/env python3
"""Bundle the twelve prediction videos with a note that says where the numbers
came from and which fixtures had no market."""
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


def main() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    lines, missing_all = [], []
    for lid, slug in LEAGUES:
        d = json.loads((DATA / f"tips-{lid}.json").read_text(encoding="utf-8"))
        rnd = d["round"].rsplit("-", 1)[-1].strip()
        lines.append(f"  {d['league']:<16} Spieltag {rnd:<3} "
                     f"{len(d['fixtures'])} von {d['round_size']} Spielen")
        for m in d["no_market"]:
            missing_all.append(f"  {d['league']}: {m}")
        for brand in ("tippsarena", "luxtipps"):
            src = OUT / f"{brand}-prognosen-{slug}.mp4"
            dest = STAGE / brand
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, dest / src.name)

    tips_table, quotes = [], []
    for lid, slug in LEAGUES:
        d = json.loads((DATA / f"tips-{lid}.json").read_text(encoding="utf-8"))
        tips_table.append(f"\n{d['league']} - Spieltag {d['round'].rsplit('-', 1)[-1].strip()}")
        tips_table.append(f"{'Spiel':<36}{'TippsArena':<18}{'LuxTipps':<18}Anstoss")
        for f in d["fixtures"]:
            pair = f"{f['home_short']} - {f['away_short']}"
            ta, lx = f["picks"]["tippsarena"], f["picks"]["luxtipps"]
            quotes += [ta["odds"], lx["odds"]]
            t = f"{ta['score']} @ {ta['odds']:.2f}".replace(".", ",")
            a = f"{lx['score']} @ {lx['odds']:.2f}".replace(".", ",")
            ko = dt.datetime.fromisoformat(f["kickoff"]).astimezone(
                zoneinfo.ZoneInfo("Europe/Berlin"))
            tips_table.append(f"{pair:<36}{t:<18}{a:<18}{ko:%d.%m. %H:%M}")
    lo, hi = min(quotes), max(quotes)
    avg = sum(quotes) / len(quotes)
    spread = (f"  Niedrigste Quote im Paket: {lo:.2f}\n"
              f"  Hoechste Quote im Paket:   {hi:.2f}\n"
              f"  Durchschnitt:              {avg:.2f}").replace(".", ",")

    missing = "\n".join(missing_all) if missing_all else "  keine"
    readme = f"""PROGNOSE-VIDEOS - 6 LIGEN x 2 MARKEN
Erstellt am {dt.date.today().strftime('%d.%m.%Y')}

12 Videos, 1080 x 1920, 30 fps, H.264, OHNE Tonspur.
Ton legst du in der App drauf - dann greift der Algorithmus, und ich
schicke dir keine fremde Musik mit ins Werbekonto.

  tippsarena/   6 Videos, dunkel/orange, @TippsArenaMoneyrace_bot
  luxtipps/     6 Videos, hell/creme/gold, @LuxTippsBot

WOHER DIE ERGEBNISSE KOMMEN
Nicht von mir. Fuer jedes Spiel wird der EXACT-SCORE-MARKT der Buchmacher
aus der API gelesen. Jede Quote wird in eine Wahrscheinlichkeit umgerechnet
und pro Buchmacher normiert (das nimmt die Marge raus - eine rohe 1/Quote
ist keine Wahrscheinlichkeit, die Buecher summieren auf etwa 1,15). Danach
wird ueber alle Buchmacher gemittelt, die den Markt stellen.

NEU: NICHT MEHR DIE NIEDRIGSTE QUOTE
Vorher stand in jedem Video das wahrscheinlichste Ergebnis. Das ist auch bei
einem klaren Favoriten nur eine 8-12-Prozent-Chance - also eine Reihe fast
identischer 1:2, die nicht haeufiger eintrifft als die Zeile daneben, aber
langweiliger aussieht.

Jetzt wird nur aus Ergebnissen gewaehlt, die zwischen 5,00 und 20,00 notiert
sind, und die Zielzone wandert ueber den Spieltag: kurz, mittel, lang, kurz,
mittel, lang. Innerhalb eines Videos wiederholt sich ein Ergebnis nicht,
solange die Liga genug Alternativen hergibt.

{spread}

Jedes Ergebnis auf dem Bildschirm ist eine Linie, die ein Buchmacher wirklich
anbietet. Die Durchschnittsquote steht im Video mit drauf, damit jeder
nachrechnen kann. Erfunden ist nichts.

  TippsArena und LuxTipps bekommen fuer dasselbe Spiel nie dasselbe
  Ergebnis - das ist im Code verboten, nicht dem Zufall ueberlassen.

ANSTOSSZEITEN
Alle Zeiten sind deutsche Ortszeit. Vorher stand dort UTC, das war der
Fehler. Deutschland und der Balkan liegen bis zum 25. Oktober auf
Sommerzeit, also aktuell UTC+2 - dieselbe Uhr, die du vor dir hast.

Im Video steht "PROGNOSE", nicht "FULL TIME". Deine Vorlage ist ein
Ergebnis-Account; diese Videos laufen VOR dem Anpfiff. Wer eine Prognose
fuer ein Ergebnis haelt, haelt den Account fuer einen Luegner, sobald der
echte Endstand kommt.

SPIELTAGE IN DIESEM PAKET
{chr(10).join(lines)}

FEHLENDE SPIELE
Fuer diese Partien gibt es in der API noch keinen Vorab-Markt (Quoten
oeffnen meist 2-3 Tage vor Anpfiff). Sie sind nicht im Video:
{missing}

  Sag Bescheid, sobald du sie brauchst - Daten neu ziehen und alle Videos
  neu rendern dauert zusammen etwa 15 Minuten.

ALLE TIPPS IM KLARTEXT
{chr(10).join(tips_table)}
"""
    (STAGE / "LIESMICH.txt").write_text(readme, encoding="utf-8")

    # One zip per brand. A single 24 MB attachment is asking to fail in a chat
    # window, and he is more likely to want one brand at a time anyway.
    for brand in ("tippsarena", "luxtipps"):
        out = ROOT / f"prognose-videos-{brand}.zip"
        if out.exists():
            out.unlink()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:  # mp4 will not shrink
            z.write(STAGE / "LIESMICH.txt", "LIESMICH.txt")
            for f in sorted((STAGE / brand).iterdir()):
                z.write(f, f.name)
        print(out.name, out.stat().st_size // 1024 // 1024, "MB")
    print(readme)


if __name__ == "__main__":
    main()
