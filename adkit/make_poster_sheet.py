#!/usr/bin/env python3
"""Contact sheet for the poster set, as a PDF.

Images do not open for him in the Freelancer chat and PDFs do, so this is how he
actually SEES the creatives. One page per message, orange row on top, green row
underneath, so the only thing changing across a row is the placement and the only
thing changing down the page is the accent - which is the decision he has to make.
"""
from __future__ import annotations

import base64
import io
import pathlib
import subprocess

from PIL import Image

import campaign
import posters

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "out" / "posters"
HTML = ROOT / "poster-sheet.html"
PDF = ROOT / "MoneyRace-Bildmotive-2-1-Sep-2026.pdf"
C = campaign.load()

TITLES = {
    "champion": ("Motiv 1 · WER WIRD TIPPSARENA CHAMPION?",
                 "Deine Überschrift. Der Preis steht als Zahl im Bild, weil die "
                 "Frage allein noch keinen Grund zum Tippen gibt."),
    "platz1": ("Motiv 2 · SCHAFFST DU ES AUF PLATZ 1?",
               "Deine zweite Überschrift, mit der Rangliste aus deinem Vorbild. "
               "Die Plätze sind leer, weil sie es sind - und genau das ist der "
               "Grund mitzumachen."),
    "preisgeld": ("Motiv 3 · 100 € FÜR DEN BESTEN TIPP",
                  "Das Angebot ohne Umweg, dazu die echten fünf Spiele der Runde. "
                  "Wer die Bundesliga kennt, kann sie nachprüfen."),
    "kein-wettschein": ("Motiv 4 · KEIN WETTSCHEIN. KEIN EINSATZ.",
                        "Räumt den Verdacht 'Wettanbieter' weg, bevor er entsteht. "
                        "Das ist auch das Motiv, das dein Werbekonto schützt."),
    "tippschluss": ("Motiv 5 · BIS SAMSTAG TIPPEN",
                    "Der Termin, nicht ein Countdown. Ein mitgerenderter Zähler "
                    "wäre in dem Moment falsch, in dem die Datei fertig ist."),
}
RATIO_LABEL = {"4x5": "4:5 · Feed (1080 × 1350)",
               "1x1": "1:1 · Feed & Karussell (1080 × 1080)",
               "9x16": "9:16 · Reels & Stories (1080 × 1920)"}
ACCENT_LABEL = {"orange": "Variante A · Orange (deine Markenfarbe)",
                "gruen": "Variante B · Grün (die Farbe deiner Vorlage)"}


def b64(path: pathlib.Path, width: int) -> str:
    im = Image.open(path).convert("RGB")
    im.thumbnail((width, width * 4), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=78, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    pages = []
    for motif in posters.MOTIFS:
        title, note = TITLES[motif]
        rows = []
        for accent in posters.ACCENTS:
            cells = []
            for ratio in posters.RATIOS:
                f = SRC / f"tippsarena-{motif}-{accent}-{ratio}.jpg"
                cells.append(
                    f'<figure><img src="data:image/jpeg;base64,{b64(f, 420)}">'
                    f'<figcaption>{RATIO_LABEL[ratio]}<br>'
                    f'<span class="fn">{f.name}</span></figcaption></figure>')
            rows.append(f'<h3>{ACCENT_LABEL[accent]}</h3>'
                        f'<div class="row">{"".join(cells)}</div>')
        pages.append(f'<section><h2>{title}</h2><p class="note">{note}</p>'
                     f'{"".join(rows)}</section>')

    head = f"""
    <section class="cover">
      <h1>MoneyRace · Bildmotive</h1>
      <p class="lead">5 Motive × 3 Formate × 2 Farbvarianten = 30 fertige Bilder
      für den Kampagnenstart am {C.lock_date}.</p>
      <table>
        <tr><td>Wettbewerb</td><td>#{C.id} · {C.name}</td></tr>
        <tr><td>Preisgeld</td><td>{C.prize_text} · {C.winner_count} Gewinner</td></tr>
        <tr><td>Tippschluss</td><td>{C.deadline_long}</td></tr>
        <tr><td>Spiele</td><td>{C.matches_worded} · {" · ".join(C.pairs())}</td></tr>
        <tr><td>Bot</td><td>@{C.bot}</td></tr>
        <tr><td>Kanalpflicht</td>
            <td>{"ja - beitreten, dann tippen" if C.requires_membership else "nein"}</td></tr>
      </table>
      <p class="warn"><b>Zwei Sachen aus deiner Vorlage sind dort falsch.</b>
      Der Bot heißt <b>@{C.bot}</b>, nicht @TIPPSARENA_MONEYRACE_BOT - den gibt es
      nicht. Und die Rangliste mit 47 / 43 / 39 Punkten und &bdquo;49. DU&ldquo;
      gibt es in deiner Datenbank nicht: dort stehen 5 Nutzer, 2 Teilnehmer und
      kein beendeter Wettbewerb. Erfundene Zahlen in einer bezahlten Anzeige sind
      das Einzige, was ein Nutzer mit einem Screenshot widerlegen kann.</p>
      <p class="warn2">Jede Zahl in jedem Bild wird beim Rendern aus dem laufenden
      Wettbewerb gelesen. Ändert sich das Preisgeld oder der Tippschluss, sind die
      30 Bilder in zwei Minuten neu erzeugt - kein Nachtippen, keine Datei, die
      still veraltet.</p>
    </section>"""

    css = """
    @page { size: A4; margin: 15mm 14mm; }
    * { box-sizing: border-box; }
    body { font: 11pt/1.5 "Lato","Helvetica Neue",Arial,sans-serif; color:#12161c; margin:0; }
    section { page-break-after: always; }
    section:last-child { page-break-after: auto; }
    h1 { font-size: 26pt; margin:0 0 6px; letter-spacing:-.5px; }
    h2 { font-size: 16pt; margin:0 0 4px; color:#0b0e12; }
    h3 { font-size: 10pt; margin:16px 0 7px; color:#5a6673; text-transform:uppercase;
         letter-spacing:.8px; border-bottom:1px solid #dfe4ea; padding-bottom:5px; }
    p.lead { font-size: 12pt; color:#39424e; margin:0 0 14px; }
    p.note { font-size: 10pt; color:#5a6673; margin:0 0 6px; }
    .row { display:flex; gap:10px; align-items:flex-end; justify-content:center;
           break-inside:avoid; }
    figure { margin:0; flex:1; break-inside:avoid; }
    h3 + .row { break-before:avoid; }
    figure img { max-height:92mm; max-width:100%; width:auto; border-radius:6px;
                 border:1px solid #d7dde4; display:block; margin:0 auto; }
    figcaption { font-size:7.5pt; color:#68727e; margin-top:5px; line-height:1.35;
                 text-align:center; }
    .fn { color:#98a3ae; font-family:"DejaVu Sans Mono",monospace; font-size:6.8pt; }
    table { border-collapse:collapse; width:100%; margin:10px 0 16px; font-size:10pt; }
    td { border-bottom:1px solid #e6eaee; padding:6px 4px; vertical-align:top; }
    td:first-child { width:34%; color:#68727e; }
    .warn { background:#fff4e8; border-left:4px solid #FF6E03; padding:11px 14px;
            font-size:10pt; margin:0 0 12px; }
    .warn2 { background:#eef6ee; border-left:4px solid #2e9e57; padding:11px 14px;
             font-size:10pt; margin:0; }
    """
    HTML.write_text(f"<html><head><meta charset='utf-8'><style>{css}</style></head>"
                    f"<body>{head}{''.join(pages)}</body></html>", encoding="utf-8")

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page()
        pg.goto(HTML.as_uri())
        pg.wait_for_timeout(500)
        pg.pdf(path=str(PDF), format="A4", print_background=True)
        b.close()
    subprocess.run(["qpdf", "--linearize", str(PDF), str(PDF) + ".t"], check=True)
    pathlib.Path(str(PDF) + ".t").replace(PDF)
    print(PDF, PDF.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
