#!/usr/bin/env python3
"""Three Facebook video ads for the competition that is actually open.

Different from render.py in one way that matters: render.py has the prize and
the Tippschluss as string literals ("149,97 €", "Samstag, 15:25 Uhr") and names
matches that are not in this round. Those were true on 29 August. Nothing here
is typed in - every figure comes from campaign.json, so a re-render after he
changes the prize or the deadline produces a correct ad instead of a confident
wrong one.

Three HOOKS so the test means something:

  1. money       - the offer, flat. Fastest thing to understand in a cold feed.
  2. objection   - "kein Wettschein", the assumption a German reader makes in
                   half a second. Also what keeps the ad account alive.
  3. deadline    - a real, dated cut-off. Best creative for the last 24 hours
                   and for retargeting everyone who clicked and did not finish.

The demo shows the channel step, because this competition has
requires_membership ON. An ad that promises one tap and delivers a join screen
buys the click and loses the person.

    python3 ads_live.py         # all three
    python3 ads_live.py 1 3     # only those
"""
from __future__ import annotations

from PIL import Image, ImageDraw
import os
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import campaign as camp                                          # noqa: E402
from brand import (                                              # noqa: E402
    W, H, FPS, ORANGE, BG, WHITE, GREY, GREEN, caption, ease_out, encode,
    font, mark, phone, rounded, wrap,
)
import brand                                                     # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out"
SCRATCH = pathlib.Path(
    "/tmp/claude-1004/-home-freelancer/9dbe74e0-4297-4b96-ba61-8a7c42919c50"
    "/scratchpad/frames"
) / f"run-{os.getpid()}"

C = camp.load()
PRIZE = C.prize_text
URL = "tippsarena.com/moneyrace"

# ---------------------------------------------------------------------------
# brand.glow() blurs a full-size mask on every call. At 30fps that is the whole
# render budget spent on a wash that never changes, so each distinct wash is
# drawn once and pasted after that. Same trick as glowed() in torjaeger.py.
_glows: dict = {}


def glow(img: Image.Image, cy: int, strength: float = 1.0, rx: int = 560,
         ry: int = 400) -> None:
    if strength <= 0:
        return
    key = (cy, round(strength, 2), rx, ry)
    if key not in _glows:
        layer = Image.new("RGB", (W, H), BG)
        brand.glow(layer, cy, strength, rx, ry)
        _glows[key] = layer
    img.paste(_glows[key], (0, 0))


def base() -> Image.Image:
    return Image.new("RGB", (W, H), BG)


def footer(img: Image.Image) -> None:
    ImageDraw.Draw(img).text(
        (W // 2, H - 250), "Kostenlos · Kein Einsatz · Keine Wette · Ab 18",
        font=font(30, "Bold"), fill=GREY, anchor="mm")


def matchlist(img: Image.Image, t: float, top: int, step: float = 0.22,
              row_h: int = 132, size: int = 44) -> None:
    """The five real fixtures, arriving one at a time.

    Naming the actual matches is what separates this from a mock-up: a reader
    who knows the Bundesliga can check it against the fixture list in his head,
    and it dates the ad to this weekend without a countdown that goes stale."""
    d = ImageDraw.Draw(img)
    f = font(size, "Bold")
    for i, pair in enumerate(C.pairs()):
        at = i * step
        if t < at:
            break
        p = ease_out(min(1.0, (t - at) / 0.3))
        y = int(top + i * (row_h + 16) + 26 * (1 - p))
        rounded(img, (95, y, W - 95, y + row_h), 24, (22, 29, 38))
        d.text((150, y + row_h // 2), pair, font=f, fill=WHITE, anchor="lm")


def ticks(img: Image.Image, t: float, rows: list[tuple[str, float]], top: int,
          size: int = 42, row_h: int = 140) -> None:
    d = ImageDraw.Draw(img)
    f = font(size, "Bold")
    for i, (text, at) in enumerate(rows):
        if t < at:
            break
        p = ease_out(min(1.0, (t - at) / 0.32))
        y = int(top + i * (row_h + 16) + 26 * (1 - p))
        rounded(img, (90, y, W - 90, y + row_h), 24, (22, 29, 38))
        cx, cy = 160, y + row_h // 2
        d.ellipse((cx - 26, cy - 26, cx + 26, cy + 26), fill=GREEN)
        d.line((cx - 12, cy, cx - 3, cy + 11), fill=BG, width=7)
        d.line((cx - 3, cy + 11, cx + 13, cy - 11), fill=BG, width=7)
        lines = wrap(d, text, f, W - 420)
        lh = 52
        ly = cy - (len(lines) - 1) * lh // 2
        for j, line in enumerate(lines):
            d.text((220, ly + j * lh), line, font=f, fill=WHITE, anchor="lm")


def cta(img: Image.Image, t: float, label: str = "KOSTENLOS MITTIPPEN") -> None:
    """The closing card, identical on all three - same landing page, same
    button, so the only variable being tested is the hook."""
    glow(img, 760, 1.0)
    mark(img, 240, 300, alpha=min(1.0, t / 0.4))
    caption(img, "TIPPSARENA", 640, size=74, colour=WHITE)
    caption(img, "MONEYRACE", 722, size=74, colour=ORANGE)

    if t > 0.3:
        p = ease_out(min(1.0, (t - 0.3) / 0.45))
        bw, by = int(880 * p), 900
        rounded(img, ((W - bw) // 2, by, (W + bw) // 2, by + 152), 76, ORANGE)
        if p > 0.7:
            ImageDraw.Draw(img).text((W // 2, by + 76), label,
                                     font=font(48, "Black"), fill=(20, 14, 6),
                                     anchor="mm")
    if t > 0.8:
        caption(img, f"Tippschluss: {C.deadline_long}", 1130, size=42,
                colour=WHITE, weight="Bold")
        caption(img, URL, 1220, size=40, colour=GREY, weight="Bold")
    footer(img)


DEMO = [
    ("Bundesliga MoneyRace", False, 0.2),
    (f"{PRIZE} für den besten Tipp.", False, 0.6),
    ("Tritt dem Kanal bei, dann geht es los.", False, 1.2),
    ("Beigetreten", True, 2.0),
    (f"Spiel 1 von {C.match_count}: {C.pairs()[0]}", False, 2.7),
    (C.fixtures[0]["away_short"], True, 3.5),
    (f"Gespeichert. Noch {C.match_count - 1} Spiele.", False, 4.2),
    ("Fertig! Du bist dabei.", False, 4.9),
]


# ===========================================================================
def ad_money(f: int) -> Image.Image:
    t = f / FPS
    img = base()

    if t < 3.2:
        glow(img, 800, min(1.0, round(t / 0.5, 1)))
        p = ease_out(min(1.0, t / 0.45))
        ImageDraw.Draw(img).text((W // 2, int(760 - 40 * (1 - p))), PRIZE,
                                 font=font(int(150 + 70 * p), "Black"),
                                 fill=ORANGE, anchor="mm")
        if t > 0.6:
            caption(img, "für den besten Tipp.", 1000, size=68, colour=WHITE)
        if t > 1.5:
            a = ease_out(min(1.0, (t - 1.5) / 0.4))
            caption(img, "Dein Einsatz: 0 €", int(1180 + 30 * (1 - a)),
                    size=72, highlight="0 €", colour=WHITE)
        if t > 2.3:
            caption(img, f"{C.league} · {C.lock_day}", 1320, size=44,
                    colour=GREY, weight="Bold")
        footer(img)

    elif t < 6.6:
        glow(img, 620, 0.55, rx=520, ry=420)
        caption(img, f"{C.matches_worded}. {C.tips_worded}.", 300, size=70,
                colour=WHITE)
        caption(img, f"Tippschluss {C.deadline_short}", 400, size=44,
                colour=ORANGE, weight="Bold")
        matchlist(img, t - 3.4, 520)
        footer(img)

    elif t < 12.4:
        glow(img, 1000, 0.4, rx=520, ry=520)
        caption(img, "So läuft es ab", 250, size=60, colour=WHITE)
        # 1080 was too short for eight bubbles: the stack grew until the top
        # one sat on the chat header and hid the bot's name. Found on a frame
        # pulled out of the encoded file, not in the code.
        phone(img, DEMO, top=380, now=t - 6.6, height=1190)
        footer(img)

    else:
        cta(img, t - 12.4)
    return img


# ===========================================================================
def ad_objection(f: int) -> Image.Image:
    t = f / FPS
    img = base()

    if t < 3.6:
        glow(img, 850, min(1.0, round(t / 0.5, 1)))
        caption(img, "Kein Wettschein.", 760, size=104, colour=WHITE)
        if t > 1.0:
            caption(img, "Ein kostenloses Tippspiel.", 920, size=68,
                    colour=ORANGE)
        if t > 2.0:
            caption(img, "Du zahlst nichts ein.", 1120, size=54, colour=GREY,
                    weight="Bold")
        if t > 2.7:
            caption(img, "Du kannst nichts verlieren.", 1210, size=54,
                    colour=GREY, weight="Bold")
        footer(img)

    elif t < 8.6:
        caption(img, "Was es wirklich ist:", 360, size=56, colour=GREY,
                weight="Bold")
        ticks(img, t - 3.6, [
            ("Kein Einsatz, kein Cent", 0.2),
            ("Keine Quote, kein Buchmacher", 0.9),
            (f"{C.matches_worded} tippen, mehr nicht", 1.6),
            (f"Wer am meisten richtig hat, bekommt {PRIZE}", 2.3),
        ], top=520)
        footer(img)

    elif t < 11.0:
        glow(img, 880, 0.8)
        caption(img, "Kostenlos mitspielen.", 800, size=76, colour=WHITE)
        if t > 9.4:
            caption(img, "Echtes Geld gewinnen.", 900, size=76, colour=ORANGE)
        if t > 10.1:
            caption(img, "Kein Haken.", 1080, size=52, colour=GREY,
                    weight="Bold")
        footer(img)

    else:
        cta(img, t - 11.0)
    return img


# ===========================================================================
def ad_deadline(f: int) -> Image.Image:
    """A dated cut-off, not a ticking counter. A countdown baked into a video
    is wrong the moment it is rendered; a date stays true until the round
    closes and can be scheduled days in advance."""
    t = f / FPS
    img = base()

    if t < 3.2:
        glow(img, 780, min(1.0, round(t / 0.5, 1)))
        caption(img, "TIPPSCHLUSS", 600, size=54, colour=ORANGE)
        p = ease_out(min(1.0, t / 0.45))
        ImageDraw.Draw(img).text(
            (W // 2, 790), f"{C.lock_day[:2].upper()} {C.lock_local:%H:%M}",
            font=font(int(120 + 50 * p), "Black"), fill=WHITE, anchor="mm")
        if t > 1.0:
            caption(img, C.deadline_long, 940, size=46, colour=GREY,
                    weight="Bold")
        if t > 1.9:
            caption(img, "Danach ist die Runde zu.", 1120, size=62,
                    colour=WHITE)
        footer(img)

    elif t < 7.4:
        glow(img, 620, 0.55, rx=520, ry=420)
        caption(img, "Diese Spiele tippst du:", 300, size=62, colour=WHITE)
        matchlist(img, t - 3.4, 460)
        footer(img)

    elif t < 9.8:
        glow(img, 820, 0.9)
        ImageDraw.Draw(img).text((W // 2, 780), PRIZE, font=font(210, "Black"),
                                 fill=ORANGE, anchor="mm")
        caption(img, "für den besten Tipp.", 980, size=64, colour=WHITE)
        if t > 8.8:
            caption(img, "Einsatz: 0 €", 1120, size=56, colour=GREY,
                    weight="Bold")
        footer(img)

    else:
        cta(img, t - 9.8, "JETZT TIPPEN")
    return img


ADS = [
    ("moneyrace-1-preisgeld", ad_money, 16.0),
    ("moneyrace-2-kein-wettschein", ad_objection, 14.5),
    ("moneyrace-3-tippschluss", ad_deadline, 13.0),
]


if __name__ == "__main__":
    wanted = {int(a) for a in sys.argv[1:] if a.isdigit()}
    print(f"campaign #{C.id}  {PRIZE}  {C.deadline_long}  "
          f"{C.matches_worded}  membership={C.requires_membership}")
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
            if f % 90 == 0:
                print(f"  {name}: {f}/{total}", flush=True)
        mp4 = OUT / f"tippsarena-{name}.mp4"
        encode(frames, mp4)
        shutil.rmtree(frames)
        print(f"{mp4.name}  {mp4.stat().st_size / 1e6:.2f} MB  {seconds}s",
              flush=True)
