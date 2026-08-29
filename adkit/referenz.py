#!/usr/bin/env python3
"""A reference cut of UGC-Skript 1 — what the video looks like before a creator shoots it.

He asked to see how a creator video would look before paying anybody to make
one. That is a different thing from an ad, and it is built differently: there is
no person in it. Where the creator goes there is a marked placeholder, so what
the film shows is the STRUCTURE - the cut points, the shot type, the framing,
the burnt-in subtitle, the length of each beat - and nothing that pretends to be
a testimonial.

Why not simply generate a person saying the lines: a face that does not exist
recommending the product is a fabricated endorsement, and it lands on his ad
account and his brand, not mine. This does the job the reference is actually
for - it is what you hand a creator - without that.

The words are UGC-Skript 1 verbatim from ugc-skripte.md, so the reference and
the brief cannot drift apart.

Run:  python3 referenz.py
"""
from PIL import Image, ImageDraw
import os
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from brand import (  # noqa: E402
    W, H, FPS, ORANGE, BG, WHITE, GREY, GREEN,
    caption, ease_out, encode, font, glow, mark, phone, rounded, wrap,
)

OUT = pathlib.Path(__file__).resolve().parent / "out"
# One directory per process. Two renders sharing a frames directory has now
# broken a render twice: the second one's rmtree deletes the first one's frames
# while it is still writing them, and the failure surfaces 450 frames later as a
# missing file. A pid in the path makes the collision impossible rather than
# unlikely.
SCRATCH = pathlib.Path(
    "/tmp/claude-1004/-home-freelancer/9dbe74e0-4297-4b96-ba61-8a7c42919c50"
    "/scratchpad/frames"
) / f"run-{os.getpid()}"
OUT.mkdir(exist_ok=True)

PRIZE = "149,97 €"
URL = "tippsarena.com/moneyrace"

PANEL = (22, 30, 40)
DIM = (58, 72, 88)

# ---------------------------------------------------------------- the script
# (start, end, shot, spoken line, highlighted phrase, note under the frame)
BEATS = [
    (2.0, 5.0, "gesicht",
     "Da liegen gerade 149,97 € auf dem Tisch, und es kostet dich nichts, mitzumachen.",
     "149,97 €",
     "Sofort losreden. Kein Hallo, kein Logo."),
    (5.0, 10.0, "gesicht",
     "Ich hab das letzte Woche gefunden. TippsArena. Läuft komplett in Telegram.",
     "TippsArena",
     "Handy hochhalten, weiter Gesicht."),
    (10.0, 18.0, "screen",
     "Du tippst einfach, wer gewinnt. Fünf Spiele, unter einer Minute durch.",
     "unter einer Minute",
     "Bildschirmaufnahme: Spiele durchtippen."),
    (18.0, 26.0, "gesicht",
     "Wer am Ende am meisten richtig hat, kriegt das Preisgeld. Ausgezahlt.",
     "Ausgezahlt.",
     "Zurück zum Gesicht."),
    (26.0, 32.0, "gesicht",
     "Kein Einsatz, keine Wette. Link ist in der Beschreibung. Kostet nichts.",
     "Kein Einsatz",
     "Letzter Satz, dann Endcard."),
]
LENGTH = 36.0
FRAME_TOP, FRAME_BOT = 300, 1180

# Five bubbles, not seven. Seven was taller than the handset, and the stack
# grew straight out of the top of it - the chat has to FIT the frame it is
# drawn in, and only looking at a rendered frame shows that.
CHAT = [
    ("Bayern München — Borussia Dortmund", False, 10.6),
    ("Bayern", True, 12.0),
    ("RB Leipzig — VfB Stuttgart", False, 13.2),
    ("Leipzig", True, 14.6),
    ("Gespeichert. Noch 3 Spiele.", False, 16.0),
]


def base() -> Image.Image:
    return Image.new("RGB", (W, H), BG)


def dashed(draw, box, colour, width=5, dash=26, gap=20):
    """A dashed rectangle - the visual shorthand for 'this is a placeholder'."""
    x0, y0, x1, y1 = box
    for x in range(x0, x1, dash + gap):
        draw.line((x, y0, min(x + dash, x1), y0), fill=colour, width=width)
        draw.line((x, y1, min(x + dash, x1), y1), fill=colour, width=width)
    for y in range(y0, y1, dash + gap):
        draw.line((x0, y, x0, min(y + dash, y1)), fill=colour, width=width)
        draw.line((x1, y, x1, min(y + dash, y1)), fill=colour, width=width)


def creator_placeholder(img: Image.Image, note: str) -> None:
    """The shot the creator fills, drawn as a diagram and never as a person.

    A silhouette, the framing guide from the brief ("face fills the top third")
    and the words PLATZHALTER across it. Nobody could mistake this for footage,
    which is the entire point.
    """
    d = ImageDraw.Draw(img)
    box = (90, FRAME_TOP, W - 90, FRAME_BOT)
    rounded(img, box, 34, PANEL)
    dashed(d, (110, FRAME_TOP + 20, W - 110, FRAME_BOT - 20), ORANGE)

    # The rule-of-thirds line the brief asks them to shoot against.
    third = FRAME_TOP + (FRAME_BOT - FRAME_TOP) // 3
    for x in range(130, W - 130, 30):
        d.line((x, third, x + 16, third), fill=DIM, width=3)
    d.text((W - 150, third - 26), "oberes Drittel", font=font(24, "Regular"),
           fill=DIM, anchor="rs")

    # Head and shoulders. Flat grey, no features - a diagram, not a face.
    cx = W // 2
    head_r = 118
    head_y = FRAME_TOP + 300
    d.ellipse((cx - head_r, head_y - head_r, cx + head_r, head_y + head_r), fill=DIM)
    d.rounded_rectangle(
        (cx - 250, head_y + head_r + 40, cx + 250, FRAME_BOT - 150),
        radius=140, fill=DIM)

    d.text((cx, FRAME_BOT - 118), "PLATZHALTER", font=font(52, "Black"),
           fill=ORANGE, anchor="mm")
    d.text((cx, FRAME_BOT - 62), "hier steht dein Creator",
           font=font(30, "Regular"), fill=GREY, anchor="mm")
    d.text((cx, FRAME_BOT + 46), note, font=font(30, "Regular"),
           fill=GREY, anchor="mm")


def screen_shot(img: Image.Image, t: float, note: str) -> None:
    """The screen-recording beat: the real bot, because that part is not a
    placeholder - he can record it himself today."""
    d = ImageDraw.Draw(img)
    rounded(img, (90, FRAME_TOP, W - 90, FRAME_BOT), 34, PANEL)
    phone(img, CHAT, top=FRAME_TOP + 30, now=t, height=FRAME_BOT - FRAME_TOP - 60)
    d.text((W // 2, FRAME_BOT + 46), note, font=font(30, "Regular"),
           fill=GREY, anchor="mm")


def strip(img: Image.Image, t: float, beat) -> None:
    """Timecode, shot type and a progress bar - the things a creator reads off
    a reference and a viewer of the finished ad never sees."""
    d = ImageDraw.Draw(img)
    start, end, shot, *_ = beat
    label = "GESICHT · FRONTKAMERA" if shot == "gesicht" else "BILDSCHIRMAUFNAHME"
    colour = ORANGE if shot == "gesicht" else GREEN

    d.text((90, 190), f"{int(start - 2)}–{int(end - 2)} s", font=font(38, "Black"),
           fill=WHITE, anchor="ls")
    d.text((W - 90, 190), label, font=font(32, "Black"), fill=colour, anchor="rs")

    # One segment per beat, so the shape of the edit is visible at a glance.
    bar_y, x = 220, 90
    span = W - 180
    for b in BEATS:
        seg = int(span * (b[1] - b[0]) / (BEATS[-1][1] - BEATS[0][0]))
        done = b[1] <= t
        here = b[0] <= t < b[1]
        rounded(img, (x, bar_y, x + seg - 8, bar_y + 10), 5,
                ORANGE if (done or here) else (44, 56, 70))
        x += seg


def subtitle(img: Image.Image, text: str, highlight: str, appeared: float) -> None:
    """The burnt-in subtitle, in the size and weight the brief asks for.

    Drawn at the real size on purpose: the commonest mistake in a first UGC cut
    is subtitles that are too small, and a reference that shows them small
    teaches the wrong thing.
    """
    d = ImageDraw.Draw(img)
    f = font(54, "Black")
    lines = wrap(d, text, f, 880)
    block = len(lines) * 68
    top = 1320
    rounded(img, (70, top - 34, W - 70, top + block + 26), 26, (16, 22, 30))
    p = ease_out(min(1.0, appeared / 0.3))
    for i, line in enumerate(lines):
        y = top + i * 68 + 34
        if highlight and highlight in line:
            before, _, after = line.partition(highlight)
            wb = d.textlength(before, font=f)
            wh = d.textlength(highlight, font=f)
            wa = d.textlength(after, font=f)
            x = (W - (wb + wh + wa)) / 2
            d.text((x, y), before, font=f, fill=WHITE, anchor="lm")
            d.text((x + wb, y), highlight, font=f, fill=ORANGE, anchor="lm")
            d.text((x + wb + wh, y), after, font=f, fill=WHITE, anchor="lm")
        else:
            d.text((W // 2, y), line, font=f, fill=WHITE, anchor="mm")
    d.text((W // 2, top + block + 74), "Untertitel sind Pflicht — über 80 % sehen ohne Ton.",
           font=font(28, "Regular"), fill=GREY, anchor="mm")


def title_card(img: Image.Image, t: float) -> None:
    """Two seconds that say what this file is, so it can never be mistaken for
    something to upload."""
    glow(img, 800, 0.8)
    mark(img, 190, 520, alpha=min(1.0, t / 0.4))
    caption(img, "SO IST DAS VIDEO AUFGEBAUT", 820, size=62, colour=WHITE)
    if t > 0.4:
        caption(img, "UGC-Skript 1 · 30 Sekunden", 920, size=42, colour=ORANGE)
    if t > 0.8:
        caption(img, "Referenz zum Zeigen — nicht zum Schalten.", 1080, size=36,
                colour=GREY, weight="Regular", max_w=880)
        caption(img, "Den Platzhalter dreht dein Creator.", 1140, size=36,
                colour=GREY, weight="Regular", max_w=880)


def end_card(img: Image.Image, t: float) -> None:
    glow(img, 760, 1.0)
    mark(img, 230, 380, alpha=min(1.0, t / 0.4))
    caption(img, "TIPPSARENA", 700, size=70, colour=WHITE)
    caption(img, "MONEYRACE", 780, size=70, colour=ORANGE)
    if t > 0.4:
        caption(img, URL, 940, size=44, colour=WHITE)
    if t > 0.8:
        caption(img, "Skript, Timing und Regeln stehen in ugc-skripte.md",
                1080, size=32, colour=GREY, weight="Regular", max_w=900)
    ImageDraw.Draw(img).text(
        (W // 2, H - 250), "Kostenlos · Kein Einsatz · Keine Wette · Ab 18",
        font=font(30, "Bold"), fill=GREY, anchor="mm")


def frame(f: int) -> Image.Image:
    t = f / FPS
    img = base()

    if t < 2.0:
        title_card(img, t)
        return img
    if t >= BEATS[-1][1]:
        end_card(img, t - BEATS[-1][1])
        return img

    beat = next(b for b in BEATS if b[0] <= t < b[1])
    _, _, shot, line, highlight, note = beat
    if shot == "gesicht":
        creator_placeholder(img, note)
    else:
        screen_shot(img, t, note)
    strip(img, t, beat)
    subtitle(img, line, highlight, t - beat[0])

    ImageDraw.Draw(img).text(
        (W // 2, H - 120), "REFERENZ · kein fertiger Werbespot",
        font=font(28, "Bold"), fill=GREY, anchor="mm")
    return img


if __name__ == "__main__":
    name = "tippsarena-ugc-referenz"
    frames = SCRATCH / name
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir(parents=True)
    total = int(LENGTH * FPS)
    for f in range(total):
        frame(f).save(frames / f"{f:05d}.png")
        if f % 120 == 0:
            print(f"  {name}: {f}/{total}")
    mp4 = OUT / f"{name}.mp4"
    encode(frames, mp4)
    shutil.rmtree(frames)
    print(f"{mp4.name}  {mp4.stat().st_size / 1e6:.2f} MB  {LENGTH}s")
