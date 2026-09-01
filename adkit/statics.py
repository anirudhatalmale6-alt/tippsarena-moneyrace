#!/usr/bin/env python3
"""Static image creatives for the MoneyRace campaign.

Why statics at all, when he already has video: a Facebook campaign with one
format cannot tell you whether the format or the message is what failed. A
static costs nothing to test, loads instantly on a bad connection, and for an
offer this simple ("free, 100 EUR, Saturday") it very often beats video on cold
traffic. Four MESSAGES, each rendered in the three placements Meta actually
serves, so the same message can be compared across placements.

Every figure comes from campaign.json - see campaign.py for why nothing is
typed in here.

    python3 statics.py            # all four, all three sizes
    python3 statics.py 2          # only concept 2
"""
from __future__ import annotations

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import pathlib
import sys

import campaign as camp

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out" / "statics"
MARK = ROOT.parent / "tippsarena-moneyrace" / "public" / "brand" / "mark-white.png"
FONTS = "/usr/share/fonts/truetype/lato"

ORANGE = (255, 110, 3)
BG = (11, 15, 20)
CARD = (22, 29, 38)
WHITE = (245, 248, 251)
GREY = (150, 163, 177)
RED = (230, 70, 60)
GREEN = (46, 200, 100)

# 4:5 is Meta's own recommendation for feed and takes the most screen; 1:1 is
# what still gets served in several placements; 9:16 is Reels and Stories.
SIZES = {"4x5": (1080, 1350), "1x1": (1080, 1080), "9x16": (1080, 1920)}

_fonts: dict = {}


def font(size: int, weight: str = "Black") -> ImageFont.FreeTypeFont:
    key = (size, weight)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(f"{FONTS}/Lato-{weight}.ttf", size)
    return _fonts[key]


def wrap(d: ImageDraw.ImageDraw, text: str, f, max_w: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if d.textlength(trial, font=f) <= max_w or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


class Sheet:
    """One canvas, one vertical stack, centred as a block.

    Elements are appended with their measured height, then drawn in one pass.
    Measuring first is what lets the same code produce a square and a 9:16
    without a second set of hand-tuned coordinates - the block simply sits in
    the middle of whatever canvas it was given.
    """

    def __init__(self, w: int, h: int):
        self.W, self.H = w, h
        self.img = Image.new("RGB", (w, h), BG)
        self.d = ImageDraw.Draw(self.img)
        self.items: list[tuple] = []          # (fn(y) -> None, height, gap)
        self.max_w = w - 150

    # ------------------------------------------------------------ background
    def glow(self, cy_frac: float = 0.42, strength: float = 1.0,
             rx: int = 520, ry: int = 380, colour=ORANGE) -> "Sheet":
        mask = Image.new("L", (self.W, self.H), 0)
        cy = int(self.H * cy_frac)
        ImageDraw.Draw(mask).ellipse(
            (self.W // 2 - rx, cy - ry, self.W // 2 + rx, cy + ry),
            fill=int(150 * strength))
        mask = mask.filter(ImageFilter.GaussianBlur(180))
        self.img.paste(Image.new("RGB", (self.W, self.H), colour), (0, 0), mask)
        return self

    # --------------------------------------------------------------- pieces
    def add(self, fn, height: int, gap: int = 0) -> "Sheet":
        self.items.append((fn, height, gap))
        return self

    def eyebrow(self, text: str, size: int = 34, colour=ORANGE, gap: int = 26):
        f = font(size, "Black")
        def draw(y):
            self.d.text((self.W // 2, y), text.upper(), font=f, fill=colour,
                        anchor="ma")
        return self.add(draw, int(size * 1.25), gap)

    def head(self, text: str, size: int = 96, colour=WHITE, weight="Black",
             gap: int = 26, highlight: str | None = None, hi=ORANGE,
             strike: bool = False):
        f = font(size, weight)
        lines = wrap(self.d, text, f, self.max_w)
        lh = int(size * 1.12)

        def draw(y):
            for i, line in enumerate(lines):
                ly = y + i * lh
                if highlight and highlight in line:
                    before, _, after = line.partition(highlight)
                    wb = self.d.textlength(before, font=f)
                    wh = self.d.textlength(highlight, font=f)
                    wa = self.d.textlength(after, font=f)
                    x = (self.W - (wb + wh + wa)) / 2
                    self.d.text((x, ly), before, font=f, fill=colour)
                    self.d.text((x + wb, ly), highlight, font=f, fill=hi)
                    self.d.text((x + wb + wh, ly), after, font=f, fill=colour)
                    if strike:
                        my = ly + int(size * 0.62)
                        self.d.line((x + wb - 8, my, x + wb + wh + 8, my),
                                    fill=RED, width=max(8, size // 12))
                else:
                    self.d.text((self.W // 2, ly), line, font=f, fill=colour,
                                anchor="ma")
                    if strike:
                        tw = self.d.textlength(line, font=f)
                        my = ly + int(size * 0.62)
                        self.d.line(((self.W - tw) / 2 - 8, my,
                                     (self.W + tw) / 2 + 8, my),
                                    fill=RED, width=max(8, size // 12))
        return self.add(draw, lh * len(lines), gap)

    def chips(self, labels: list[str], size: int = 34, gap: int = 34):
        """One row of pill labels. Falls to two rows if the row is too wide -
        a chip row that overflows is worse than a chip row that wraps."""
        f = font(size, "Black")
        pad_x, ph, space = 30, int(size * 2.1), 18

        widths = [self.d.textlength(t, font=f) + pad_x * 2 for t in labels]
        rows: list[list[int]] = [[]]
        used = 0.0
        for i, w in enumerate(widths):
            if used + w + space * len(rows[-1]) > self.max_w and rows[-1]:
                rows.append([])
                used = 0.0
            rows[-1].append(i)
            used += w
        height = len(rows) * ph + (len(rows) - 1) * 16

        def draw(y):
            yy = y
            for row in rows:
                total = sum(widths[i] for i in row) + space * (len(row) - 1)
                x = (self.W - total) / 2
                for i in row:
                    self.d.rounded_rectangle((x, yy, x + widths[i], yy + ph),
                                             radius=ph // 2, fill=None,
                                             outline=(70, 82, 96), width=3)
                    self.d.text((x + widths[i] / 2, yy + ph / 2), labels[i],
                                font=f, fill=GREY, anchor="mm")
                    x += widths[i] + space
                yy += ph + 16
        return self.add(draw, height, gap)

    def rows(self, lines: list[str], size: int = 40, tick: bool = False,
             gap: int = 34):
        """A stack of cards - the match list, or the what-it-is list."""
        f = font(size, "Bold")
        rh = int(size * 1.9)
        step = rh + 14

        def draw(y):
            for i, text in enumerate(lines):
                yy = y + i * step
                self.d.rounded_rectangle((75, yy, self.W - 75, yy + rh),
                                         radius=20, fill=CARD)
                x = 125
                if tick:
                    cx, cy = 122, yy + rh // 2
                    self.d.ellipse((cx - 20, cy - 20, cx + 20, cy + 20),
                                   fill=GREEN)
                    self.d.line((cx - 9, cy, cx - 2, cy + 8), fill=BG, width=5)
                    self.d.line((cx - 2, cy + 8, cx + 10, cy - 8), fill=BG,
                                width=5)
                    x = 170
                self.d.text((x, yy + rh // 2), text, font=f, fill=WHITE,
                            anchor="lm")
        return self.add(draw, step * len(lines) - 14, gap)

    def button(self, label: str, size: int = 44, gap: int = 26):
        f = font(size, "Black")
        bw = int(self.d.textlength(label, font=f) + 130)
        bw = min(bw, self.W - 120)
        bh = int(size * 2.9)

        def draw(y):
            x0 = (self.W - bw) // 2
            self.d.rounded_rectangle((x0, y, x0 + bw, y + bh), radius=bh // 2,
                                     fill=ORANGE)
            self.d.text((self.W // 2, y + bh // 2), label, font=f,
                        fill=(20, 14, 6), anchor="mm")
        return self.add(draw, bh, gap)

    def small(self, text: str, size: int = 32, colour=GREY, weight="Bold",
              gap: int = 20):
        f = font(size, weight)
        lines = wrap(self.d, text, f, self.max_w)
        lh = int(size * 1.3)

        def draw(y):
            for i, line in enumerate(lines):
                self.d.text((self.W // 2, y + i * lh), line, font=f,
                            fill=colour, anchor="ma")
        return self.add(draw, lh * len(lines), gap)

    def logo(self, size: int = 130, gap: int = 30):
        m = Image.open(MARK).convert("RGBA")
        m.thumbnail((size, size), Image.LANCZOS)

        def draw(y):
            self.img.paste(m, ((self.W - m.width) // 2, y), m)
        return self.add(draw, m.height, gap)

    # ---------------------------------------------------------------- finish
    def render(self, path: pathlib.Path, shift: int = 0,
               fill: float = 0.74) -> pathlib.Path:
        """Draw the stack, centred, opened out to roughly `fill` of the canvas.

        The first version centred the measured stack and stopped there, which
        left the 4:5 sheets about half empty below the button - correct
        arithmetic, unfinished-looking poster. Slack is spread across the gaps
        (capped, or a four-element sheet turns into four islands) rather than
        by growing the type, so the same wording holds at every ratio."""
        gaps = [g for _, _, g in self.items[:-1]]
        total = sum(h for _, h, _ in self.items) + sum(gaps)
        target = int(self.H * fill)
        if gaps and total < target:
            extra = min((target - total) / len(gaps), 70)
            self.items = [(fn, h, g + (extra if i < len(gaps) else 0))
                          for i, (fn, h, g) in enumerate(self.items)]
            total += extra * len(gaps)

        y = int((self.H - total) // 2 + shift)
        for fn, h, g in self.items:
            fn(y)
            y += int(h + g)

        # The line the ad account needs, always at the bottom, always clear of
        # the platform's own furniture.
        f = font(28, "Bold")
        self.d.text((self.W // 2, self.H - int(self.H * 0.055)),
                    "Kostenlos · Kein Einsatz · Keine Wette · Ab 18",
                    font=f, fill=(96, 107, 120), anchor="mm")
        path.parent.mkdir(parents=True, exist_ok=True)
        self.img.save(path, quality=95)
        return path


# ===========================================================================
# The four messages. Each takes the canvas size, so the SAME message renders
# for every placement - a square that is a cropped 9:16 always loses its
# headline, which is how most accounts end up testing nothing.
# ===========================================================================
def c1_offer(c: camp.Campaign, w: int, h: int) -> Sheet:
    """The offer, flat. The fastest thing to understand in a cold feed."""
    tall = h / w > 1.4
    s = Sheet(w, h).glow(0.40 if tall else 0.44)
    s.eyebrow(f"{c.league} · {c.lock_day}", gap=30)
    s.head(c.prize_text, size=210 if tall else 180, colour=ORANGE, gap=18)
    s.head("für den besten Tipp.", size=64 if tall else 58, gap=40)
    s.chips([f"Einsatz {camp.money(0)}", "Keine Wette", c.matches_worded], gap=44)
    s.button("KOSTENLOS MITTIPPEN", gap=22)
    s.small(f"Tippschluss: {c.deadline_long}")
    return s


def c2_deadline(c: camp.Campaign, w: int, h: int) -> Sheet:
    """Urgency that is real and dated. The matches are named because a named
    fixture is what proves this is happening this weekend and not a mock-up."""
    tall = h / w > 1.4
    s = Sheet(w, h).glow(0.30, strength=0.8)
    s.eyebrow("TIPPSCHLUSS", gap=16)
    s.head(f"{c.lock_day[:2].upper()} {c.lock_local.strftime('%H:%M')}",
           size=170 if tall else 140, colour=ORANGE, gap=22)
    s.head(f"{c.matches_worded} tippen. {c.prize_text} gewinnen.",
           size=54 if tall else 50, gap=36)
    s.rows(c.pairs()[: 5 if tall else 3], size=38 if tall else 36, gap=40)
    s.button("JETZT TIPPEN", gap=20)
    s.small("Danach ist die Runde zu.")
    return s


def c3_objection(c: camp.Campaign, w: int, h: int) -> Sheet:
    """The assumption a German reader makes in half a second, answered before
    they scroll past it. This one also protects the ad account.

    The first draft struck a red line through the words "keine Wette", which
    on a still image negates the negation - it reads as "this IS a bet". The
    strike is gone; two flat statements do the job and cannot be misread."""
    tall = h / w > 1.4
    s = Sheet(w, h).glow(0.38, strength=0.7)
    s.head("Kein Wettschein.", size=92 if tall else 80, gap=16)
    s.head("Ein kostenloses Tippspiel.", size=60 if tall else 54,
           colour=ORANGE, gap=38)
    s.rows(["Kein Einsatz, kein Cent",
            "Keine Quote, kein Buchmacher",
            f"{c.matches_worded} tippen, mehr nicht",
            f"Wer am meisten richtig hat, bekommt {c.prize_text}"],
           size=38 if tall else 34, tick=True, gap=46)
    s.button("KOSTENLOS MITTIPPEN", gap=22)
    s.small(f"Tippschluss: {c.deadline_long}")
    return s


def c4_challenge(c: camp.Campaign, w: int, h: int) -> Sheet:
    """Ego, not money. Football fans believe they know better than the next
    person and that belief is free to act on here."""
    tall = h / w > 1.4
    s = Sheet(w, h).glow(0.44)
    s.logo(size=170 if tall else 130, gap=30)
    s.eyebrow(f"{c.matches_worded}. {c.tips_worded}.", gap=28)
    s.head("Tippst du besser als der Rest?", size=96 if tall else 82, gap=34)
    s.head(f"{c.prize_text} für den Besten.", size=62 if tall else 56,
           colour=ORANGE, gap=42)
    s.button("GEGEN ALLE ANTRETEN", gap=20)
    s.small(f"Kostenlos · Tippschluss {c.deadline_short}")
    return s


CONCEPTS = [
    ("1-preisgeld", c1_offer),
    ("2-tippschluss", c2_deadline),
    ("3-keine-wette", c3_objection),
    ("4-challenge", c4_challenge),
]


if __name__ == "__main__":
    c = camp.load()
    wanted = {int(a) for a in sys.argv[1:] if a.isdigit()}
    made = []
    for index, (slug, fn) in enumerate(CONCEPTS, start=1):
        if wanted and index not in wanted:
            continue
        for ratio, (w, h) in SIZES.items():
            p = OUT / f"moneyrace-{slug}-{ratio}.jpg"
            # 9:16 stays deliberately tighter: Stories and Reels put their own
            # UI over the top and bottom sixth, so filling the canvas there
            # means burying the headline under a profile bubble.
            fn(c, w, h).render(p, fill=0.60 if h / w > 1.4 else 0.78)
            made.append(p)
            print(f"{p.name}  {w}x{h}  {p.stat().st_size / 1024:.0f} KB")
    print(f"\n{len(made)} files in {OUT}")
