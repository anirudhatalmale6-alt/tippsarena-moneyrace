#!/usr/bin/env python3
"""Drawing primitives for the MoneyRace poster set.

Built against the creative he sent on 1 Sept: night stadium, one huge slanted
headline with the second line in the accent colour, a dark card in the middle,
a fat pill CTA and the Telegram handle at the foot.

Two things about that reference are NOT copied:

  * Its handle reads `@TIPPSARENA_MONEYRACE_BOT`. **The bot is
    `@TippsArenaMoneyrace_bot`** - the other one does not exist, and an ad
    pointing at a dead handle spends money for nothing. Every poster reads the
    handle out of `campaign.json`.
  * Its ranking shows 47 / 43 / 39 points and "49. DU". His database has 5
    users, 2 participants and 0 finished competitions, so those numbers are
    invented, and inventing a crowd is the one claim in an ad that a screenshot
    can disprove. The ranking panel here says Platz 1 is still free, which is
    both true and a better reason to tap.

The background is drawn, not photographed - a stock stadium is somebody's
copyright and this has to be safe to run as a paid ad for years.
"""
from __future__ import annotations

import math
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = "/usr/share/fonts/truetype/lato"
EMOJI_FONT = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"

# His brand, sampled from his own logo file.
ORANGE = (255, 110, 3)
# The green of the creative he sent. Not his brand - kept as a switch so he can
# compare the two on the same layout instead of imagining it.
LIME = (166, 226, 46)
LIME = (154, 224, 61)

WHITE = (247, 250, 253)
GREY = (163, 176, 190)
INK = (10, 13, 17)
CARD = (18, 23, 30)

_cache: dict = {}


def font(size: int, weight: str = "Black") -> ImageFont.FreeTypeFont:
    key = (size, weight)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(f"{FONTS}/Lato-{weight}.ttf", size)
    return _cache[key]


def emoji(char: str, size: int) -> Image.Image:
    """Noto Color Emoji is a bitmap font: it only loads at 109px. Asking for the
    size you want silently produces nothing."""
    key = ("e", char, size)
    if key not in _cache:
        f = ImageFont.truetype(EMOJI_FONT, 109)
        im = Image.new("RGBA", (150, 150), (0, 0, 0, 0))
        ImageDraw.Draw(im).text((75, 75), char, font=f, anchor="mm",
                                embedded_color=True)
        im = im.crop(im.getbbox() or (0, 0, 150, 150))
        im.thumbnail((size, size), Image.LANCZOS)
        _cache[key] = im
    return _cache[key]


# --------------------------------------------------------------- background
def stadium(w: int, h: int, seed: int = 7) -> Image.Image:
    """A floodlit stadium at night, drawn.

    Three bands - sky, stand, pitch - plus bloom from four floodlights and a
    crowd made of blurred dots. The vignette at the end is what stops the
    corners competing with the headline.
    """
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h), (7, 10, 14))
    d = ImageDraw.Draw(img)

    horizon = int(h * 0.62)

    # Sky: a very dark blue that lifts towards the stands.
    for y in range(0, horizon):
        t = y / horizon
        d.line([(0, y), (w, y)],
               fill=(int(6 + 14 * t), int(9 + 18 * t), int(14 + 26 * t)))

    # The stand, as a dense field of out-of-focus heads. Drawn into its own
    # layer so one blur covers the lot; blurring per dot would take minutes.
    # Density rises towards the pitch and the tier gangways are drawn as dark
    # bands - a perfectly even field of dots reads as falling snow, which is
    # what the first render looked like.
    top_stand = int(horizon * 0.24)
    crowd = Image.new("RGB", (w, horizon), (0, 0, 0))
    cd = ImageDraw.Draw(crowd)
    tiers = [top_stand + (horizon - top_stand) * f for f in (0.34, 0.68)]
    for _ in range(int(w * h / 620)):
        y = rnd.randint(top_stand, horizon)
        if any(abs(y - t) < horizon * 0.022 for t in tiers):
            continue                      # gangway: nobody sits there
        x = rnd.randint(0, w)
        t = (y - top_stand) / (horizon - top_stand + 1)
        r = 1.5 + t * 4.5
        v = int(rnd.randint(18, 80) * (0.45 + 0.55 * t))
        cd.ellipse((x - r, y - r, x + r, y + r), fill=(v, int(v * 1.04), int(v * 1.18)))
    crowd = crowd.filter(ImageFilter.GaussianBlur(w / 500))
    img.paste(Image.blend(img.crop((0, 0, w, horizon)), crowd, 0.62), (0, 0))

    # The barrier and the advertising boards. Without them the crowd stops dead
    # against the grass on a razor-straight line and the whole thing reads as
    # two rectangles rather than as a stadium.
    board_h = max(6, int(h * 0.028))
    d.rectangle((0, horizon - board_h, w, horizon), fill=(9, 12, 17))
    d.line([(0, horizon - board_h), (w, horizon - board_h)], fill=(26, 33, 44),
           width=max(1, int(h / 900)))
    d.line([(0, horizon), (w, horizon)], fill=(30, 46, 30), width=max(1, int(h / 900)))

    # Pitch.
    for y in range(horizon, h):
        t = (y - horizon) / max(1, h - horizon)
        d.line([(0, y), (w, y)],
               fill=(int(11 + 18 * t), int(28 + 44 * t), int(14 + 21 * t)))
    # Mown stripes in perspective - they converge on a vanishing point well
    # above the horizon, so the pitch reads as receding rather than as a set of
    # diagonal bands lying flat on the poster.
    stripe = Image.new("RGBA", (w, h - horizon), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripe)
    pd = h - horizon
    n = 10
    for i in range(0, n, 2):
        near0, near1 = w * (i / n - 0.55) * 2.1, w * ((i + 1) / n - 0.55) * 2.1
        far0, far1 = near0 * 0.20 + w * 0.5 * 0.80, near1 * 0.20 + w * 0.5 * 0.80
        sd.polygon([(far0 + w * 0.0, 0), (far1, 0),
                    (near1 + w * 0.5, pd), (near0 + w * 0.5, pd)],
                   fill=(255, 255, 255, 13))
    img.paste(Image.alpha_composite(
        img.crop((0, horizon, w, h)).convert("RGBA"), stripe).convert("RGB"),
        (0, horizon))

    # Floodlights: one blurred disc each, then a cross flare so they read as
    # lamps rather than as four moons.
    lights = Image.new("RGB", (w, h), (0, 0, 0))
    ld = ImageDraw.Draw(lights)
    for fx, fy, r in ((0.10, 0.16, 0.30), (0.88, 0.10, 0.26),
                      (0.32, 0.05, 0.18), (0.66, 0.20, 0.20)):
        cx, cy, rr = fx * w, fy * h, r * w
        ld.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(46, 56, 74))
        ld.ellipse((cx - rr * 0.16, cy - rr * 0.16, cx + rr * 0.16, cy + rr * 0.16),
                   fill=(190, 205, 230))
        ld.line([(cx - rr * 1.3, cy), (cx + rr * 1.3, cy)], fill=(70, 82, 105),
                width=max(2, int(w / 200)))
    lights = lights.filter(ImageFilter.GaussianBlur(w / 26))
    img = Image.blend(img, Image.new("RGB", (w, h), (0, 0, 0)), 0.0)
    img = _screen(img, lights)

    # Sparks drifting in the light. Cheap, and it stops the sky looking flat.
    sp = Image.new("RGB", (w, h), (0, 0, 0))
    spd = ImageDraw.Draw(sp)
    for _ in range(int(w / 6)):
        x, y = rnd.randint(0, w), rnd.randint(0, int(h * 0.75))
        r = rnd.choice((1, 1, 2, 2, 3))
        v = rnd.randint(60, 170)
        spd.ellipse((x - r, y - r, x + r, y + r), fill=(v, int(v * 0.78), int(v * 0.42)))
    img = _screen(img, sp.filter(ImageFilter.GaussianBlur(w / 700)))

    # Vignette.
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((-w * 0.30, -h * 0.22, w * 1.30, h * 1.22), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(w / 8)).point(lambda v: 255 - v)
    img.paste(Image.new("RGB", (w, h), (0, 0, 0)), (0, 0), mask.point(lambda v: int(v * 0.92)))
    return img


def ease_out(t: float) -> float:
    """Fast, then settling. Anything linear reads as a slideshow."""
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def _screen(a: Image.Image, b: Image.Image) -> Image.Image:
    from PIL import ImageChops
    return ImageChops.screen(a, b)


def scrim(img: Image.Image, top: float = 0.42, bottom: float = 0.40,
          power: float = 1.0) -> None:
    """Darken the top and the foot so white type survives whatever is behind it.

    Without this the headline sits on floodlight bloom in one corner and on a
    dark stand in the other, and half of it disappears.
    """
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    ht, hb = int(h * top), int(h * bottom)
    for y in range(ht):
        md.line([(0, y), (w, y)], fill=int(215 * power * (1 - y / ht) ** 1.4))
    for y in range(hb):
        md.line([(0, h - 1 - y), (w, h - 1 - y)],
                fill=int(230 * power * (1 - y / hb) ** 1.3))
    img.paste(Image.new("RGB", (w, h), (4, 6, 9)), (0, 0), mask)


# --------------------------------------------------------------------- type
def squeeze_text(text: str, f: ImageFont.FreeTypeFont, fill, squeeze: float = 0.86,
                 shear: float = 0.0) -> Image.Image:
    """Render one line, then compress it horizontally.

    There is no heavy condensed display face installed, and the reference
    headline is condensed italic. Drawing Lato Black Italic and squeezing the
    bitmap gets there; picking a lighter weight to fit would have lost the
    shout, which is the whole job of the line.
    """
    pad = int(f.size * 0.6)
    probe = Image.new("RGBA", (10, 10))
    tw = int(ImageDraw.Draw(probe).textlength(text, font=f))
    im = Image.new("RGBA", (tw + pad * 2, int(f.size * 1.75)), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((pad, int(f.size * 0.20)), text, font=f, fill=fill)
    im = im.crop(im.getbbox() or (0, 0, im.width, im.height))
    if squeeze != 1.0:
        im = im.resize((max(1, int(im.width * squeeze)), im.height), Image.LANCZOS)
    if shear:
        im = im.transform(
            (im.width + int(abs(shear) * im.height), im.height),
            Image.AFFINE, (1, shear, -shear * im.height if shear > 0 else 0, 0, 1, 0),
            resample=Image.BICUBIC)
    return im


def shadowed(layer: Image.Image, blur: float, spread: int = 0,
             colour=(0, 0, 0), alpha: int = 220) -> Image.Image:
    """Put a soft drop shadow under a rendered text layer."""
    pad = int(blur * 3) + spread + 4
    out = Image.new("RGBA", (layer.width + pad * 2, layer.height + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", out.size, (0, 0, 0, 0))
    sh.paste(Image.new("RGBA", layer.size, colour + (alpha,)), (pad, pad + spread),
             layer.getchannel("A"))
    out = Image.alpha_composite(out, sh.filter(ImageFilter.GaussianBlur(blur)))
    out.alpha_composite(layer, (pad, pad))
    return out


def paste_c(img: Image.Image, layer: Image.Image, cx: int, cy: int) -> None:
    img.paste(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)), layer)


def text(d: ImageDraw.ImageDraw, xy, s: str, f, fill, anchor="mm") -> None:
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


def wrap(d: ImageDraw.ImageDraw, s: str, f, max_w: int) -> list[str]:
    out, line = [], ""
    for word in s.split():
        trial = f"{line} {word}".strip()
        if d.textlength(trial, font=f) <= max_w or not line:
            line = trial
        else:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out


# ------------------------------------------------------------------- shapes
def pill(img: Image.Image, box, fill, radius=None) -> None:
    x0, y0, x1, y1 = box
    r = radius if radius is not None else (y1 - y0) / 2
    ImageDraw.Draw(img).rounded_rectangle(box, radius=r, fill=fill)


def card(img: Image.Image, box, fill=CARD, alpha: int = 235, radius: int = 40,
         outline=None, width: int = 0) -> None:
    """A translucent dark card, so the stadium still shows through it."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        box, radius=radius, fill=fill + (alpha,),
        outline=(outline + (255,)) if outline else None, width=width)
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))


def glow_behind(img: Image.Image, cx: int, cy: int, rx: int, ry: int,
                colour, strength: float = 0.55) -> None:
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry),
                                 fill=int(255 * strength))
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) / 7))
    img.paste(Image.alpha_composite(
        img.convert("RGBA"),
        Image.merge("RGBA", (*[Image.new("L", (w, h), c) for c in colour], mask))
    ).convert("RGB"), (0, 0))


def trophy(size: int) -> Image.Image:
    return emoji("\U0001F3C6", size)


_MARK = None


def brand_disc(size: int, bg=ORANGE) -> Image.Image:
    """His logo on an orange disc - the same lockup as his Telegram avatar.

    `mark.png` is the BLACK silhouette, which is the version that belongs on
    orange. Pasting the white one here would be a different logo.
    """
    global _MARK
    key = ("disc", size, bg)
    if key in _cache:
        return _cache[key]
    if _MARK is None:
        import pathlib
        _MARK = Image.open(
            pathlib.Path(__file__).resolve().parent.parent
            / "tippsarena-moneyrace" / "public" / "brand" / "mark.png"
        ).convert("RGBA")
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse((0, 0, s - 1, s - 1), fill=bg)
    m = _MARK.copy()
    m.thumbnail((int(s * 0.62), int(s * 0.62)), Image.LANCZOS)
    im.paste(m, ((s - m.width) // 2, (s - m.height) // 2), m)
    im = im.resize((size, size), Image.LANCZOS)
    _cache[key] = im
    return im


def arrow(d: ImageDraw.ImageDraw, x: int, y: int, s: int, fill) -> None:
    """A right arrow, drawn. Lato has no arrow glyph and the missing-glyph box
    on a CTA button is the most expensive tofu there is."""
    t = max(3, int(s * 0.16))
    d.line([(x - s * 0.55, y), (x + s * 0.42, y)], fill=fill, width=t)
    d.polygon([(x + s * 0.62, y), (x + s * 0.20, y - s * 0.36),
               (x + s * 0.20, y + s * 0.36)], fill=fill)


def telegram(size: int) -> Image.Image:
    """The Telegram disc, drawn: circle plus a paper plane."""
    key = ("tg", size)
    if key in _cache:
        return _cache[key]
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((0, 0, s, s), fill=(41, 171, 226))
    d.polygon([(0.20 * s, 0.50 * s), (0.80 * s, 0.27 * s), (0.66 * s, 0.75 * s),
               (0.50 * s, 0.60 * s), (0.40 * s, 0.70 * s), (0.40 * s, 0.555 * s)],
              fill=(255, 255, 255))
    d.polygon([(0.40 * s, 0.555 * s), (0.40 * s, 0.70 * s), (0.50 * s, 0.60 * s)],
              fill=(214, 236, 247))
    im = im.resize((size, size), Image.LANCZOS)
    _cache[key] = im
    return im


def check(size: int, colour) -> Image.Image:
    key = ("ck", size, colour)
    if key in _cache:
        return _cache[key]
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((0, 0, s - 1, s - 1), fill=colour)
    d.line([(0.27 * s, 0.52 * s), (0.44 * s, 0.69 * s), (0.75 * s, 0.34 * s)],
           fill=INK, width=int(s * 0.11), joint="curve")
    im = im.resize((size, size), Image.LANCZOS)
    _cache[key] = im
    return im


def medal(size: int, place: int) -> Image.Image:
    """Gold / silver / bronze disc with the number in it. Drawn rather than
    emoji so the digit is always centred and always legible at ad size."""
    key = ("md", size, place)
    if key in _cache:
        return _cache[key]
    cols = {1: ((255, 205, 60), (146, 106, 0)),
            2: ((214, 222, 232), (108, 118, 132)),
            3: ((214, 145, 74), (120, 74, 28))}
    face, edge = cols.get(place, cols[3])
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((0, 0, s - 1, s - 1), fill=edge)
    d.ellipse((s * 0.09, s * 0.09, s * 0.91, s * 0.91), fill=face)
    f = ImageFont.truetype(f"{FONTS}/Lato-Black.ttf", int(s * 0.62))
    d.text((s / 2, s * 0.52), str(place), font=f, fill=edge, anchor="mm")
    im = im.resize((size, size), Image.LANCZOS)
    _cache[key] = im
    return im
