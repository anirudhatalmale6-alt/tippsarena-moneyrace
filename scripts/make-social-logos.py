#!/usr/bin/env python3
"""Build the seven profile pictures from the one TippsArena mark.

Every platform he named crops a profile picture to a CIRCLE and then shows it
about 40 pixels wide in a list. Two rules follow from that, and they decide
every choice in this file:

  * Nothing that matters may sit outside the inscribed circle. The safe area is
    a circle of radius 0.5 * size; the corners are decoration only.
  * At 40px a word is a smudge. So the channels are told apart by BACKGROUND and
    RING first - which survive any size - and a word is added only where two
    variants would otherwise look identical in a list.

The mark itself is never redrawn. It is his artwork, lifted off the orange
background once (public/brand/mark.png) and recoloured, never re-illustrated.
"""
from PIL import Image, ImageDraw, ImageFont
import pathlib

SIZE = 1024
ROOT = pathlib.Path(__file__).resolve().parent.parent
MARK = ROOT / "public" / "brand" / "mark.png"
OUT = ROOT / "public" / "brand" / "social"
OUT.mkdir(parents=True, exist_ok=True)

ORANGE = (255, 110, 3)
ORANGE_DEEP = (214, 84, 0)
BLACK = (10, 10, 10)
DARK = (13, 17, 23)
DARK_2 = (26, 20, 12)
WHITE = (255, 255, 255)
GOLD = (245, 179, 1)

FONT = "/usr/share/fonts/truetype/lato/Lato-Black.ttf"


def tinted(colour, scale=0.62):
    """The mark, recoloured, scaled to `scale` of the canvas width."""
    mark = Image.open(MARK).convert("RGBA")
    solid = Image.new("RGBA", mark.size, colour + (255,))
    solid.putalpha(mark.getchannel("A"))
    target = int(SIZE * scale)
    solid.thumbnail((target, target), Image.LANCZOS)
    return solid


def canvas(top, bottom=None):
    """A square, flat or with a soft vertical gradient."""
    if bottom is None:
        return Image.new("RGB", (SIZE, SIZE), top)
    base = Image.new("RGB", (SIZE, SIZE), top)
    draw = ImageDraw.Draw(base)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        draw.line(
            [(0, y), (SIZE, y)],
            fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    return base


def ring(img, colour, width=18, inset=34):
    draw = ImageDraw.Draw(img)
    draw.ellipse(
        [inset, inset, SIZE - inset, SIZE - inset],
        outline=colour,
        width=width,
    )


def place(img, mark, dy=0):
    img.paste(mark, ((SIZE - mark.width) // 2, (SIZE - mark.height) // 2 + dy), mark)


def caption(img, text, colour, y, size=88, track=6):
    """A word, letter-spaced, centred, and kept inside the safe circle."""
    font = ImageFont.truetype(FONT, size)
    draw = ImageDraw.Draw(img)
    letters = list(text)
    widths = [draw.textlength(c, font=font) for c in letters]
    total = sum(widths) + track * (len(letters) - 1)
    x = (SIZE - total) / 2
    for c, w in zip(letters, widths):
        draw.text((x, y), c, font=font, fill=colour, anchor="lm")
        x += w + track


def save(img, name):
    path = OUT / f"tippsarena-{name}.png"
    img.save(path)
    # Telegram accepts 512; Facebook and Instagram render around 320. One extra
    # small file each so nothing has to be resized by hand.
    small = img.resize((512, 512), Image.LANCZOS)
    small.save(OUT / f"tippsarena-{name}-512.png")
    print(f"  {path.name}")


# --------------------------------------------------------------- 1. Facebook page
# The master. Plain orange, mark centred - this is the one everything else is a
# variation of, so it carries no extra device at all.
img = canvas(ORANGE, ORANGE_DEEP)
place(img, tinted(BLACK, 0.66))
save(img, "facebook-page")

# --------------------------------------------------------------- 2. Facebook group
# Same brand, one ring, and the word that tells the two Facebook entries apart
# in a list where they would otherwise be the same picture twice.
img = canvas(ORANGE, ORANGE_DEEP)
# The mark is smaller and lifted here, and the word sits below the pretzel
# rather than across it - at 40px an overlap reads as a printing fault.
place(img, tinted(BLACK, 0.50), dy=-84)
ring(img, BLACK, width=14, inset=26)
caption(img, "COMMUNITY", BLACK, SIZE - 224, size=68, track=9)
save(img, "facebook-group")

# --------------------------------------------------------------- 3. Instagram
# Instagram profile pictures sit on white and are small. A dark disc gives the
# mark the contrast it loses at 40px, with the orange as the ring.
img = canvas(DARK, (30, 20, 12))
ring(img, ORANGE, width=26, inset=22)
place(img, tinted(ORANGE, 0.60))
save(img, "instagram")

# --------------------------------------------------- 4. Telegram main channel
# Orange with a white ring: the loudest, most recognisable version, for the
# channel most people meet first.
img = canvas(ORANGE, ORANGE_DEEP)
ring(img, WHITE, width=22, inset=24)
place(img, tinted(BLACK, 0.58))
save(img, "telegram-channel")

# ------------------------------------------------------ 5. Telegram VIP channel
# Deliberately NOT orange. VIP has to be distinguishable from the main channel
# at a glance in a chat list, and a different colour does that where a badge on
# the same orange would not.
img = canvas(DARK_2, (8, 8, 8))
ring(img, GOLD, width=24, inset=22)
place(img, tinted(GOLD, 0.52), dy=-64)
caption(img, "VIP", GOLD, SIZE - 208, size=112, track=16)
save(img, "telegram-vip")

# ---------------------------------------------------- 6. Telegram personal
# Quiet on purpose: this is him, not a brand shouting. Dark with a thin orange
# ring, mark in white.
img = canvas(DARK, (18, 24, 32))
ring(img, ORANGE, width=12, inset=40)
place(img, tinted(WHITE, 0.58))
save(img, "telegram-personal")

# --------------------------------------------------- 7. Telegram MoneyRace
# The product channel. Black on orange with the name, because "MoneyRace" is the
# thing being advertised and this picture appears next to prize-money posts.
img = canvas(ORANGE, ORANGE_DEEP)
place(img, tinted(BLACK, 0.48), dy=-96)
caption(img, "MONEYRACE", BLACK, SIZE - 214, size=82, track=5)
save(img, "telegram-moneyrace")

print(f"\n7 logos written to {OUT}")
