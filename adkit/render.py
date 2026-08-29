#!/usr/bin/env python3
"""Three Facebook ads for TippsArena MoneyRace.

Three different HOOKS, not three edits of one ad, so they can be run against
each other and the winner means something:

  1. money   - "150 € liegen auf dem Tisch. Einsatz: 0 €."
  2. objection - "Das ist keine Wette." The thing a cold German reader assumes
                 within half a second, answered before they scroll past it.
  3. effort  - "30 Sekunden." For everyone who believes it must be complicated.

Every claim on screen is true of the product: no stake, no odds, no bookmaker,
free entry, results from the official feed, prize paid to whoever gets the most
right. There is no invented win rate and no invented testimonial.

Run:  python3 render.py
"""
from PIL import Image, ImageDraw
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from brand import (  # noqa: E402
    W, H, FPS, ORANGE, ORANGE_HI, BG, WHITE, GREY, GREEN, RED,
    caption, ease_out, ease_in_out, emoji, encode, font, glow, mark, phone,
    rounded,
)

OUT = pathlib.Path(__file__).resolve().parent / "out"
# Frames are scratch - thousands of PNGs, written once and thrown away. They
# went in the project directory at first, and a second run's rmtree deleted the
# first run's frames while it was still writing them.
SCRATCH = pathlib.Path(
    "/tmp/claude-1004/-home-freelancer/9dbe74e0-4297-4b96-ba61-8a7c42919c50"
    "/scratchpad/frames"
)
OUT.mkdir(exist_ok=True)

# The prize is his real one, rounded DOWN to the round number an ad can carry.
# 149,97 € is the truth; "150 €" would be a rounding UP and is not used.
PRIZE = "149,97 €"
URL = "tippsarena.com/moneyrace"


def base() -> Image.Image:
    return Image.new("RGB", (W, H), BG)


def footer(img: Image.Image, alpha: float = 1.0) -> None:
    """The line that has to be on every frame for the ad account's sake, kept
    clear of the bottom 200px where Facebook puts its own furniture."""
    d = ImageDraw.Draw(img)
    c = tuple(int(GREY[i] * alpha + BG[i] * (1 - alpha)) for i in range(3))
    d.text((W // 2, H - 250), "Kostenlos · Kein Einsatz · Keine Wette · Ab 18",
           font=font(30, "Bold"), fill=c, anchor="mm")


def cta(img: Image.Image, t: float, label: str = "JETZT KOSTENLOS MITTIPPEN") -> None:
    """The closing card. Identical on all three, because the ad that follows is
    the same landing page and the same button."""
    glow(img, 760, 1.0)
    mark(img, 260, 300, alpha=min(1.0, t / 0.4))

    p = ease_out(min(1.0, t / 0.5))
    caption(img, "TIPPSARENA", 660, size=76, colour=WHITE)
    caption(img, "MONEYRACE", 745, size=76, colour=ORANGE)

    # The button, arriving a beat after the name.
    if t > 0.35:
        bp = ease_out(min(1.0, (t - 0.35) / 0.45))
        bw = int(860 * bp)
        by = 980
        rounded(img, ((W - bw) // 2, by, (W + bw) // 2, by + 150), 75, ORANGE)
        if bp > 0.7:
            ImageDraw.Draw(img).text(
                (W // 2, by + 75), label, font=font(48, "Black"),
                fill=(20, 14, 6), anchor="mm")

    if t > 0.9:
        caption(img, URL, 1230, size=44, colour=WHITE)
        caption(img, "Ein Klick. Telegram öffnet sich.", 1310, size=34,
                colour=GREY, weight="Regular")
    footer(img)


# ===========================================================================
def ad_money(f: int) -> Image.Image:
    """Hook: the money is real and it costs nothing to go for it."""
    t = f / FPS
    img = base()

    if t < 3.4:
        # The number first. Nothing before it - no logo, no title card.
        glow(img, 800, min(1.0, t / 0.5))
        p = ease_out(min(1.0, t / 0.45))
        size = int(150 + 60 * p)
        ImageDraw.Draw(img).text((W // 2, int(820 - 40 * (1 - p))), PRIZE,
                                 font=font(size, "Black"), fill=ORANGE, anchor="mm")
        if t > 0.7:
            caption(img, "liegen gerade auf dem Tisch.", 1060, size=64,
                    colour=WHITE)
        if t > 1.7:
            a = ease_out(min(1.0, (t - 1.7) / 0.4))
            caption(img, "Dein Einsatz: 0 €", int(1230 + 30 * (1 - a)), size=72,
                    highlight="0 €", colour=WHITE)
        footer(img)

    elif t < 6.6:
        # Say what it is, before showing it.
        glow(img, 900, 0.7)
        caption(img, "Kein Einsatz.", 720, size=78, colour=WHITE)
        if t > 4.2:
            caption(img, "Keine Wette.", 850, size=78, colour=WHITE)
        if t > 4.9:
            caption(img, "Keine Anmeldung.", 980, size=78, colour=WHITE)
        if t > 5.7:
            caption(img, "Nur tippen.", 1140, size=90, colour=ORANGE)
        footer(img)

    elif t < 15.4:
        # The product, doing the thing the words just promised.
        local = t - 6.6
        glow(img, 1100, 0.45, rx=520, ry=520)
        caption(img, "So läuft es ab", 250, size=62, colour=WHITE)
        phone(img, [
            (f"Bundesliga MoneyRace — Preisgeld {PRIZE}", False, 0.3),
            ("Tippschluss: Samstag, 15:25 Uhr", False, 1.1),
            ("Mainz 05 — Paderborn. Wer gewinnt?", False, 2.2),
            ("Mainz 05", True, 3.6),
            ("Gespeichert. Noch 4 Spiele.", False, 4.4),
            ("Fertig! Du bist dabei.", False, 6.0),
        ], top=380, now=local, height=1240)
        footer(img)

    elif t < 20.2:
        glow(img, 900, 0.8)
        caption(img, "Wer am meisten richtig tippt,", 780, size=68, colour=WHITE)
        if t > 16.6:
            caption(img, "bekommt das Preisgeld.", 900, size=68,
                    colour=ORANGE)
        if t > 17.9:
            e = emoji("🏆", 150)
            img.paste(e, ((W - e.width) // 2, 1080), e)
        if t > 18.7:
            caption(img, "Ausgezahlt. Kein Gutschein.", 1300, size=48,
                    colour=GREY, weight="Bold")
        footer(img)

    else:
        cta(img, t - 20.2)
    return img


# ===========================================================================
def ad_objection(f: int) -> Image.Image:
    """Hook: kill the assumption that stops the scroll - "this is gambling"."""
    t = f / FPS
    img = base()

    if t < 4.2:
        glow(img, 850, min(1.0, t / 0.5))
        caption(img, "Nein.", 640, size=140, colour=WHITE)
        if t > 0.8:
            p = ease_out(min(1.0, (t - 0.8) / 0.4))
            caption(img, "Das ist KEINE Wette.", 880, size=int(82 * (0.9 + 0.1 * p)),
                    highlight="KEINE", colour=WHITE)
        if t > 1.9:
            # A line struck through the word, drawn rather than described.
            p = ease_out(min(1.0, (t - 1.9) / 0.45))
            d = ImageDraw.Draw(img)
            x0, x1 = 250, 250 + int(580 * p)
            d.line((x0, 880, x1, 880), fill=RED, width=12)
        if t > 2.7:
            caption(img, "Du zahlst nichts ein.", 1120, size=62, colour=GREY,
                    weight="Bold")
        if t > 3.4:
            caption(img, "Du kannst nichts verlieren.", 1210, size=62,
                    colour=GREY, weight="Bold")
        footer(img)

    elif t < 9.0:
        caption(img, "Was es wirklich ist:", 420, size=58, colour=GREY,
                weight="Bold")
        rows = [
            ("Ein kostenloses Tippspiel", 4.7),
            ("Du tippst gegen andere Fans", 5.5),
            ("Kein Buchmacher, keine Quote", 6.3),
            ("Wer am meisten richtig hat, gewinnt", 7.1),
        ]
        y = 620
        for text, at in rows:
            if t >= at:
                p = ease_out(min(1.0, (t - at) / 0.35))
                yy = int(y + 30 * (1 - p))
                rounded(img, (90, yy, W - 90, yy + 150), 26, (22, 29, 38))
                e = emoji("✅", 62)
                img.paste(e, (140, yy + 44), e)
                d = ImageDraw.Draw(img)
                d.text((240, yy + 75), text, font=font(44, "Bold"), fill=WHITE,
                       anchor="lm")
            y += 176
        footer(img)

    elif t < 16.2:
        local = t - 9.0
        glow(img, 1100, 0.45, rx=520, ry=520)
        caption(img, "Und das Geld ist echt", 250, size=62, colour=WHITE)
        phone(img, [
            (f"Preisgeld dieser Runde: {PRIZE}", False, 0.3),
            ("Union Berlin — Frankfurt. Wer gewinnt?", False, 1.4),
            ("Unentschieden", True, 2.8),
            ("Gespeichert.", False, 3.5),
            ("Ergebnisse kommen automatisch rein.", False, 4.6),
        ], top=380, now=local, height=1240)
        footer(img)

    elif t < 20.4:
        glow(img, 900, 0.8)
        caption(img, "Kostenlos mitspielen.", 800, size=76, colour=WHITE)
        if t > 17.6:
            caption(img, "Echtes Geld gewinnen.", 920, size=76, colour=ORANGE)
        if t > 18.6:
            caption(img, "Beides gleichzeitig. Kein Haken.", 1120, size=48,
                    colour=GREY, weight="Bold")
        footer(img)

    else:
        cta(img, t - 20.4)
    return img


# ===========================================================================
def ad_effort(f: int) -> Image.Image:
    """Hook: it takes no time. For everyone who assumes it must be work."""
    t = f / FPS
    img = base()

    if t < 3.6:
        glow(img, 820, min(1.0, t / 0.5))
        p = ease_out(min(1.0, t / 0.4))
        ImageDraw.Draw(img).text((W // 2, 780), "30", font=font(int(280 * p) or 1, "Black"),
                                 fill=ORANGE, anchor="mm")
        if t > 0.5:
            caption(img, "SEKUNDEN", 960, size=88, colour=WHITE)
        if t > 1.4:
            caption(img, "So lange dauert eine Runde.", 1160, size=56,
                    colour=GREY, weight="Bold")
        if t > 2.4:
            caption(img, "Wirklich.", 1260, size=56, colour=ORANGE, weight="Bold")
        footer(img)

    elif t < 14.0:
        # The demo IS the argument here, so it runs longer and the counter
        # underneath makes the claim checkable while you watch.
        local = t - 3.6
        glow(img, 1150, 0.45, rx=520, ry=520)
        caption(img, "Im Zeitraffer:", 230, size=52, colour=GREY, weight="Bold")
        secs = min(30, int(local * 2.6))
        ImageDraw.Draw(img).text((W // 2, 310), f"{secs} s", font=font(66, "Black"),
                                 fill=ORANGE, anchor="mm")
        phone(img, [
            ("Spiel 1 von 5", False, 0.2),
            ("Leipzig — Gladbach", False, 0.6),
            ("Leipzig", True, 1.6),
            ("Spiel 2 von 5: Köln — Hoffenheim", False, 2.4),
            ("Unentschieden", True, 3.6),
            ("Spiel 3 von 5: Mainz — Paderborn", False, 4.4),
            ("Mainz 05", True, 5.6),
            ("Fertig. Du bist dabei!", False, 6.6),
        ], top=390, now=local, height=1230)
        footer(img)

    elif t < 18.6:
        glow(img, 900, 0.8)
        caption(img, "Fertig.", 700, size=110, colour=WHITE)
        if t > 15.2:
            caption(img, "Mehr ist es nicht.", 860, size=64, colour=GREY,
                    weight="Bold")
        if t > 16.2:
            caption(img, "Keine App. Kein Konto.", 1030, size=58, colour=WHITE)
        if t > 17.1:
            caption(img, "Kein Cent.", 1120, size=58, colour=ORANGE)
        footer(img)

    else:
        cta(img, t - 18.6, "KOSTENLOS MITTIPPEN")
    return img


# ===========================================================================
ADS = [
    ("tippsarena-ad-1-preisgeld", ad_money, 26.0),
    ("tippsarena-ad-2-keine-wette", ad_objection, 25.0),
    ("tippsarena-ad-3-30-sekunden", ad_effort, 23.0),
]

# `python3 render.py 2 3` renders only those, so a wording fix in one ad does
# not cost twenty minutes of re-encoding the other two.

if __name__ == "__main__":
    wanted = {int(a) for a in sys.argv[1:] if a.isdigit()}
    for index, (name, fn, seconds) in enumerate(ADS, start=1):
        if wanted and index not in wanted:
            continue
        frames = SCRATCH / name
        if frames.exists():
            shutil.rmtree(frames)
        frames.mkdir(parents=True)
        total = int(seconds * FPS)
        for f in range(total):
            fn(f).save(frames / f"{f:05d}.png")
            if f % 120 == 0:
                print(f"  {name}: {f}/{total}")
        mp4 = OUT / f"{name}.mp4"
        encode(frames, mp4)
        shutil.rmtree(frames)
        print(f"{mp4.name}  {mp4.stat().st_size / 1e6:.2f} MB  {seconds}s")
