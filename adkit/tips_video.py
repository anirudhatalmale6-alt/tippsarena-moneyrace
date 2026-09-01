#!/usr/bin/env python3
"""Matchday prediction videos, in the style of the TikTok he sent.

    python3 tips_video.py                       # both brands, all six leagues
    python3 tips_video.py --brand tippsarena 78 # one brand, one league

His brief: "the team logos and after 1-2 seconds the imagined result appear",
one video per league, for the upcoming fixtures, plus the same six again for
LuxTipps with a different background and different scores.

REVISION 2 SEPT, from his notes:

  * the footer CTA lines come off both brands. He named them: "jetzt kostenlos
    mitmachen" and "mitmachen auf telegram". The handle stays, because a video
    with no destination is a video that cannot convert;
  * the scoreline is no longer the market favourite. "you picked always the
    lowest odd ... we know most of these won't end like this and it's not
    interesting to watch". He is right - the most likely exact score is an 8-12%
    shot, so publishing it every week is a column of 1:2s that is no more
    accurate than its neighbours. `fetch_tips.py` now picks inside a 5.00-20.00
    price band and rotates the zone down the matchday. Both brands still publish
    a real quoted line, never one of mine, and the quote is printed on screen;
  * kick-off times are LOCAL, not UTC. They were raw UTC before, which is the
    hour he was reading as wrong;
  * LuxTipps is rebuilt rather than recoloured - "i need completely different
    design so no one can say hm this is actually same site". Cream instead of
    black, dark bands top and bottom, round badges instead of white tiles, a
    two-row scorecard instead of a side-by-side, and a different animation.

The header says PROGNOSE, never FULL TIME. His reference is a results account;
these go out BEFORE kick-off, and a viewer who reads a prediction as a result
will believe the account lies the moment the real score lands.

Frames are piped straight into ffmpeg as raw RGB. Writing 1200 PNGs per video
would be 1.5 GB on disk per file and slower than the drawing itself.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import subprocess
import zoneinfo
from PIL import Image, ImageDraw, ImageFilter

import poster as P

W, H = 1080, 1920
FPS = 30
ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
CRESTS = DATA / "img" / "teams"
OUT = ROOT / "out" / "tips"

INTRO = 2.4
MATCH = 3.6
OUTRO = 3.2
REVEAL = 1.35          # when the score appears, inside each match segment

#: He wrote "you forgot i am timezone +1". The videos were printing raw UTC,
#: which is the bug. The fix is not +1 though: Germany and the Balkans are both
#: on summer time until 25 October, so his own clock - and his audience's - is
#: currently +2. This renders the real local hour rather than a fixed offset,
#: which stays correct after the changeover too. One string to flip if he
#: genuinely wants a hard UTC+1.
TZ = zoneinfo.ZoneInfo("Europe/Berlin")


class Brand:
    def __init__(self, key, name, style, bg, accent, ink, bot, disc):
        self.key, self.name, self.style = key, name, style
        self.bg, self.accent, self.ink = bg, accent, ink
        self.bot, self.disc = bot, disc


def _tippsarena_disc(size: int) -> Image.Image:
    return P.brand_disc(size, P.ORANGE)


_LUX = None


def _lux_disc(size: int) -> Image.Image:
    """His LuxTipps avatar, used as-is. It is already a disc."""
    global _LUX
    key = ("luxdisc", size)
    if key in P._cache:
        return P._cache[key]
    if _LUX is None:
        _LUX = Image.open(ROOT.parent / "luxtipps-avatar-1024.png").convert("RGBA")
    im = _LUX.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    P._cache[key] = im
    return im


CREAM = (243, 240, 232)
CHAR = (17, 17, 19)
GOLD = (201, 158, 60)

BRANDS = {
    "tippsarena": Brand(
        "tippsarena", "TIPPSARENA", "dark",
        bg=(9, 12, 17), accent=P.ORANGE, ink=(10, 13, 17),
        bot="@TippsArenaMoneyrace_bot",
        disc=_tippsarena_disc),
    "luxtipps": Brand(
        "luxtipps", "LUXTIPPS", "light",
        bg=CREAM, accent=GOLD, ink=CHAR,
        bot="@LuxTippsBot",
        disc=_lux_disc),
}


# ------------------------------------------------------------------ background
def backdrop(b: Brand) -> Image.Image:
    """One image per video, drawn once. Everything else is composited onto a
    copy of it, which is what makes 1200 frames affordable."""
    if b.style == "light":
        img = Image.new("RGB", (W, H), b.bg)
        # A paper-ish warm shading rather than a glow - the dark set gets its
        # depth from light on black, this one has to get it from shadow on
        # cream, or it reads as an unfinished export.
        lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        for x in range(-H, W + H, 54):
            ld.line([(x, 0), (x + H, H)], fill=(CHAR[0], CHAR[1], CHAR[2], 7),
                    width=3)
        img = Image.alpha_composite(img.convert("RGBA"), lay).convert("RGB")
        shade = Image.new("L", (W, H), 0)
        ImageDraw.Draw(shade).ellipse((-W * 0.30, -H * 0.12, W * 1.30, H * 1.12),
                                      fill=255)
        shade = shade.filter(ImageFilter.GaussianBlur(200)).point(
            lambda v: int((255 - v) * 0.26))
        img.paste(Image.new("RGB", (W, H), (120, 108, 84)), (0, 0), shade)
        return img

    img = Image.new("RGB", (W, H), b.bg)
    d = ImageDraw.Draw(img)
    # A wash of the brand colour top and bottom, and a faint pitch-stripe
    # fan so the panel is not floating on flat black.
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-300, -820, W + 300, 380), fill=(74, 30, 3))
    gd.ellipse((-300, H - 340, W + 300, H + 820), fill=(58, 24, 2))
    img = P._screen(img, glow.filter(ImageFilter.GaussianBlur(210)))
    fan = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fan)
    for i in range(-6, 7):
        fd.polygon([(W / 2, H * 0.5), (W / 2 + i * 300, -400),
                    (W / 2 + (i + 0.45) * 300, -400)],
                   fill=(255, 255, 255, 4))
    img = Image.alpha_composite(img.convert("RGBA"), fan).convert("RGB")
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse((-W * 0.34, -H * 0.16, W * 1.34, H * 1.16),
                                 fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(190)).point(lambda v: 255 - v)
    img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0),
              mask.point(lambda v: int(v * 0.85)))
    return img


# ------------------------------------------------------------------- furniture
FRAME = (52, 372, W - 52, 1592)
BAND_TOP = 300
BAND_BOT = H - 232


def chrome(img: Image.Image, b: Brand, league: str, round_label: str) -> None:
    """Logo, league line, the frame, and the handle. Same on every frame of a
    video, so it is drawn into the backdrop once.

    The two CTA lines that used to live under the handle are gone - he asked
    for them off both brands.
    """
    d = ImageDraw.Draw(img)
    if b.style == "light":
        d.rectangle((0, 0, W, BAND_TOP), fill=CHAR)
        d.rectangle((0, BAND_BOT, W, H), fill=CHAR)
        disc = b.disc(104)
        f = P.font(62, "Black")
        tw = d.textlength(b.name, font=f)
        x = (W - (disc.width + 26 + tw)) / 2
        img.paste(disc, (int(x), BAND_TOP // 2 - disc.height // 2), disc)
        d.text((x + disc.width + 26, BAND_TOP // 2), b.name, font=f,
               fill=CREAM, anchor="lm")
        d.text((W / 2, 372), f"{league.upper()} · {round_label.upper()}",
               font=P.font(40, "Black"), fill=CHAR, anchor="mm")
        d.line((330, 404, W - 330, 404), fill=b.accent, width=5)
        d.text((W / 2, BAND_BOT + 116), b.bot, font=P.font(52, "Black"),
               fill=b.accent, anchor="mm")
        return

    disc = b.disc(96)
    f = P.font(60, "Black")
    tw = d.textlength(b.name, font=f)
    row = disc.width + 24 + tw
    x = (W - row) / 2
    img.paste(disc, (int(x), 118), disc)
    d.text((x + disc.width + 24, 118 + 48), b.name, font=f, fill=P.WHITE,
           anchor="lm")
    d.text((W / 2, 262), f"{league.upper()} · {round_label.upper()}",
           font=P.font(38, "Black"), fill=b.accent, anchor="mm")
    ImageDraw.Draw(img).rounded_rectangle(FRAME, radius=54, outline=P.WHITE,
                                          width=7)
    d.text((W / 2, 1720), b.bot, font=P.font(50, "Black"), fill=b.accent,
           anchor="mm")


def tile(crest: str | None, size: int = 300) -> Image.Image:
    """A white rounded tile with the club crest in it - exactly his reference.

    A crest on the dark background alone is unreadable for half the clubs in
    Europe; the white tile is what makes Dortmund and Juventus both work.
    """
    key = ("tile", crest, size)
    if key in P._cache:
        return P._cache[key]
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((0, 0, size - 1, size - 1),
                                         radius=int(size * 0.20),
                                         fill=(246, 248, 250))
    _crest_into(im, crest, size, 0.72)
    P._cache[key] = im
    return im


def badge(crest: str | None, size: int = 188) -> Image.Image:
    """LuxTipps: a ROUND badge with a dark ring, on cream. A different shape
    from the orange set's white square, so a viewer scrolling past both never
    pairs them.

    The core is cream, not charcoal. I measured all 100 crests in the six
    leagues against a charcoal disc: Liverpool, Nottingham Forest and HSV have
    almost no ink bright enough to read on it, and Liverpool is in the flagship
    Premier League video. Three failures out of a hundred is still three videos
    with a hole where a badge should be.
    """
    key = ("badge", crest, size)
    if key in P._cache:
        return P._cache[key]
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((0, 0, size - 1, size - 1), fill=CHAR)
    pad = int(size * 0.085)
    d.ellipse((pad, pad, size - 1 - pad, size - 1 - pad), fill=(250, 249, 245))
    d.ellipse((pad - 4, pad - 4, size + 3 - pad, size + 3 - pad),
              outline=GOLD, width=3)
    _crest_into(im, crest, size, 0.58)
    P._cache[key] = im
    return im


def _crest_into(im: Image.Image, crest: str | None, size: int, frac: float) -> None:
    if not crest:
        return
    path = CRESTS / crest
    if not path.exists():
        return
    c = Image.open(path).convert("RGBA")
    c = c.resize((int(size * frac), int(size * frac)), Image.LANCZOS)
    im.paste(c, ((size - c.width) // 2, (size - c.height) // 2), c)


def _fit(d: ImageDraw.ImageDraw, text: str, room: int, top: int,
         weight: str = "Black"):
    """Largest size at or below `top` that fits `text` into `room` pixels.

    Kaiserslautern is fourteen characters and Inter is five; a single size for
    both either overflows the row or wastes half of it.
    """
    for size in range(top, 25, -2):
        f = P.font(size, weight)
        if d.textlength(text, font=f) <= room:
            return f
    return P.font(26, weight)


def _local(iso: str) -> dt.datetime:
    return dt.datetime.fromisoformat(iso).astimezone(TZ)


_DAYS = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"]


def _weekday(iso: str) -> str:
    t = _local(iso)
    return _DAYS[t.weekday()] + t.strftime(" %d.%m.")


def _when(fx: dict) -> str:
    return f"{_weekday(fx['kickoff'])} · {_local(fx['kickoff']):%H:%M} UHR"


def _quote(tip: dict) -> str | None:
    """German decimals. Only ever a price a bookmaker actually published - a
    Poisson fixture carries a fair 1/p, which is not a quote and does not go on
    screen as one."""
    if not tip.get("quoted"):
        return None
    return "QUOTE " + f"{tip['odds']:.2f}".replace(".", ",")


def _tip_of(fx: dict, b: Brand) -> dict:
    return fx["picks"][b.key]


# --------------------------------------------------------------- dark layout
def match_layers_dark(base, b, fx, index, total):
    tip = _tip_of(fx, b)
    cx, cy = W // 2, 900
    size, gap = 300, 118
    lx, rx = cx - gap - size, cx + gap

    pre = base.copy()
    d = ImageDraw.Draw(pre)
    d.text((cx, 470), "PROGNOSE", font=P.font(104, "Black"), fill=P.WHITE,
           anchor="mm")
    d.text((cx, 552), _when(fx), font=P.font(34, "Black"),
           fill=(150, 163, 178), anchor="mm")

    # Names sit UNDER their own tile, not centred on the canvas - a long name
    # next to a short one otherwise drifts across the halfway line.
    for x, name in ((lx, fx["home_short"]), (rx, fx["away_short"])):
        label = name.upper()
        f = _fit(d, label, size + 70, 40)
        d.text((x + size / 2, cy + size / 2 + 62), label, font=f,
               fill=P.WHITE, anchor="mm")

    if total:
        # A viewer scrolling a 40-second video wants to know how much is left.
        d.text((cx, 1532), f"SPIEL {index} VON {total}", font=P.font(34, "Black"),
               fill=(132, 145, 160), anchor="mm")

    post = pre.copy()
    _score_dark(post, b, tip, 1.0)
    return pre, post, (lx, rx, cy, size, tip)


def _score_dark(img: Image.Image, b: Brand, tip: dict, k: float) -> None:
    text = f"{tip['home']} : {tip['away']}"
    lay = P.squeeze_text(text, P.font(190, "Black"), P.WHITE, 1.0)
    lay = P.shadowed(lay, 26, 8)
    if k != 1.0:
        lay = lay.resize((max(1, int(lay.width * k)), max(1, int(lay.height * k))),
                         Image.LANCZOS)
    P.glow_behind(img, W // 2, 1320, int(300 * k), int(150 * k), b.accent, 0.45)
    P.paste_c(img, lay, W // 2, 1320)
    q = _quote(tip)
    if q and k > 0.9:
        ImageDraw.Draw(img).text((W // 2, 1432), q, font=P.font(40, "Black"),
                                 fill=b.accent, anchor="mm")


def _vs(img: Image.Image, b: Brand, cx: int, cy: int, k: float = 1.0) -> None:
    r = int(66 * k)
    d = ImageDraw.Draw(img)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=b.accent)
    if k > 0.55:
        f = P.font(int(46 * k), "Black")
        d.text((cx, cy - 20 * k), "V", font=f, fill=b.ink, anchor="mm")
        d.text((cx, cy + 20 * k), "S", font=f, fill=b.ink, anchor="mm")


# -------------------------------------------------------------- light layout
BADGE = 188
ROW_Y = (812, 1062)
BOX = 150


def match_layers_light(base, b, fx, index, total):
    """Two rows, one per club, each with its own goal box on the right.

    Nothing here is the dark layout with different colours: the reading order is
    top-to-bottom rather than left-to-right, so the score arrives as two numbers
    landing on two teams instead of one number in the middle.
    """
    tip = _tip_of(fx, b)
    pre = base.copy()
    d = ImageDraw.Draw(pre)

    # kick-off, in a dark pill
    label = _when(fx)
    f = P.font(36, "Black")
    tw = d.textlength(label, font=f)
    bw = tw + 76
    d.rounded_rectangle(((W - bw) / 2, 524, (W + bw) / 2, 594), radius=35,
                        fill=CHAR)
    d.text((W / 2, 560), label, font=f, fill=CREAM, anchor="mm")

    rows = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rows)
    for y, name, crest in ((ROW_Y[0], fx["home_short"], fx["home_crest"]),
                           (ROW_Y[1], fx["away_short"], fx["away_crest"])):
        bg_ = badge(crest, BADGE)
        rows.paste(bg_, (92, y - BADGE // 2), bg_)
        nf = _fit(rd, name.upper(), 520, 64)
        rd.text((312, y), name.upper(), font=nf, fill=CHAR, anchor="lm")
    rd.line((92, (ROW_Y[0] + ROW_Y[1]) // 2, W - 92,
             (ROW_Y[0] + ROW_Y[1]) // 2), fill=(206, 200, 186), width=3)

    if total:
        d.text((W / 2, 1590), f"SPIEL {index} VON {total}",
               font=P.font(34, "Black"), fill=(140, 133, 118), anchor="mm")

    post = pre.copy()
    post.paste(rows, (0, 0), rows)
    _score_light(post, b, tip, 1.0)
    return pre, post, rows, tip


def _score_light(img: Image.Image, b: Brand, tip: dict, k: float) -> None:
    """Goal boxes punch in; the PROGNOSE bar wipes across underneath."""
    d = ImageDraw.Draw(img)
    for y, goals in ((ROW_Y[0], tip["home"]), (ROW_Y[1], tip["away"])):
        s = int(BOX * min(1.0, k))
        if s < 8:
            continue
        x0, y0 = W - 92 - BOX + (BOX - s) // 2, y - s // 2
        d.rounded_rectangle((x0, y0, x0 + s, y0 + s), radius=int(s * 0.22),
                            fill=CHAR)
        if k > 0.5:
            d.text((x0 + s / 2, y0 + s / 2), str(goals),
                   font=P.font(int(96 * min(1.0, k)), "Black"), fill=b.accent,
                   anchor="mm")

    w = int((W - 184) * min(1.0, k))
    if w < 20:
        return
    d.rounded_rectangle((92, 1286, 92 + w, 1406), radius=16, fill=b.accent)
    if k > 0.85:
        d.text((132, 1346), "PROGNOSE", font=P.font(46, "Black"), fill=CHAR,
               anchor="lm")
        q = _quote(tip)
        if q:
            d.text((W - 132, 1346), q, font=P.font(46, "Black"), fill=CHAR,
                   anchor="rm")


# ------------------------------------------------------------------- rendering
def cards(b: Brand, data: dict):
    """Yield every frame of the video, in order, as RGB images."""
    base = backdrop(b)
    chrome(base, b, data["league"], _round_label(data["round"]))
    light = b.style == "light"
    ink = CHAR if light else P.WHITE
    dim = (140, 133, 118) if light else (160, 172, 186)

    # --- intro
    intro = base.copy()
    d = ImageDraw.Draw(intro)
    d.text((W / 2, 760), "PROGNOSEN", font=P.font(120, "Black"), fill=ink,
           anchor="mm")
    d.text((W / 2, 880), "ZUM SPIELTAG", font=P.font(70, "Black"),
           fill=b.accent if not light else CHAR, anchor="mm")
    d.text((W / 2, 1020), data["league"].upper(), font=P.font(64, "Black"),
           fill=ink, anchor="mm")
    when = f"{_weekday(data['fixtures'][0]['kickoff'])} – " \
           f"{_weekday(data['fixtures'][-1]['kickoff'])}"
    d.text((W / 2, 1110), when, font=P.font(40, "Bold"), fill=dim, anchor="mm")
    d.text((W / 2, 1300), f"{len(data['fixtures'])} SPIELE",
           font=P.font(52, "Black"), fill=b.accent, anchor="mm")
    # Says where the numbers come from, on screen, in the video itself.
    d.text((W / 2, 1500), "Ergebnisse aus dem Quotenmarkt · 5.00 bis 20.00",
           font=P.font(30, "Bold"), fill=dim, anchor="mm")
    for _ in range(int(INTRO * FPS)):
        yield intro

    # --- one segment per fixture
    n = int(MATCH * FPS)
    for i, fx in enumerate(data["fixtures"], 1):
        total = len(data["fixtures"])
        if light:
            pre, post, rows, tip = match_layers_light(base, b, fx, i, total)
            for j in range(n):
                t = j / FPS
                if t < 0.42:
                    p = P.ease_out(t / 0.42)
                    f = pre.copy()
                    f.paste(rows, (int(-(1 - p) * W), 0), rows)
                    yield f
                elif t < REVEAL:
                    f = pre.copy()
                    f.paste(rows, (0, 0), rows)
                    yield f
                elif t < REVEAL + 0.30:
                    p = P.ease_out((t - REVEAL) / 0.30)
                    f = pre.copy()
                    f.paste(rows, (0, 0), rows)
                    _score_light(f, b, tip, p)
                    yield f
                else:
                    yield post
            continue

        pre, post, (lx, rx, cy, size, tip) = match_layers_dark(base, b, fx, i, total)
        lt, rt = tile(fx["home_crest"], size), tile(fx["away_crest"], size)
        for j in range(n):
            t = j / FPS
            if t < 0.42:
                # tiles fly in from the sides, VS pops once they have landed
                p = P.ease_out(t / 0.42)
                f = pre.copy()
                f.paste(lt, (int(lx - (1 - p) * (lx + size + 40)), cy - size // 2), lt)
                f.paste(rt, (int(rx + (1 - p) * (W - rx + 40)), cy - size // 2), rt)
                if t > 0.30:
                    _vs(f, b, W // 2, cy, P.ease_out((t - 0.30) / 0.16))
                yield f
                continue
            if t < REVEAL:
                f = pre.copy()
            elif t < REVEAL + 0.30:
                # 1.35 s after the crests land, which is the "after 1-2 seconds
                # the imagined result appear" he asked for.
                p = P.ease_out((t - REVEAL) / 0.30)
                f = pre.copy()
                _score_dark(f, b, tip, 1.55 - 0.55 * p)
            else:
                f = post.copy()
            f.paste(lt, (lx, cy - size // 2), lt)
            f.paste(rt, (rx, cy - size // 2), rt)
            _vs(f, b, W // 2, cy)
            yield f

    # --- outro
    outro = base.copy()
    d = ImageDraw.Draw(outro)
    disc = b.disc(300)
    outro.paste(disc, ((W - disc.width) // 2, 560), disc)
    d.text((W / 2, 960), "ALLE TIPPS", font=P.font(96, "Black"), fill=ink,
           anchor="mm")
    d.text((W / 2, 1058), "JEDEN SPIELTAG", font=P.font(70, "Black"),
           fill=b.accent if not light else CHAR, anchor="mm")
    # The CTA line he struck out used to sit in this pill. The handle is the
    # only thing left that tells a viewer where to go, so the handle takes it.
    f = P.font(50, "Black")
    label = b.bot
    tw = d.textlength(label, font=f)
    bw, bh = tw + 190, 124
    box = ((W - bw) / 2, 1250, (W + bw) / 2, 1250 + bh)
    if not light:
        P.glow_behind(outro, W // 2, 1250 + bh // 2, int(bw * 0.55),
                      int(bh * 1.1), b.accent, 0.30)
    P.pill(outro, box, b.accent if not light else CHAR)
    dd = ImageDraw.Draw(outro)
    x = (W - (tw + 96)) / 2
    fg = b.ink if not light else CREAM
    dd.text((x, 1250 + bh / 2 + 2), label, font=f, fill=fg, anchor="lm")
    P.arrow(dd, int(x + tw + 46), int(1250 + bh / 2), 44, fg)
    for _ in range(int(OUTRO * FPS)):
        yield outro


def _round_label(rnd: str) -> str:
    """'Regular Season - 3' is API-Football's wording, not something a German
    football fan has ever read."""
    tail = rnd.rsplit("-", 1)[-1].strip()
    return f"Spieltag {tail}" if tail.isdigit() else rnd


def render(brand_key: str, league_id: int) -> pathlib.Path:
    b = BRANDS[brand_key]
    data = json.loads((DATA / f"tips-{league_id}.json").read_text(encoding="utf-8"))
    fixtures = [f for f in data["fixtures"] if brand_key in f.get("picks", {})]
    if not fixtures:
        raise SystemExit(f"no fixtures with a pick for league {league_id}")
    data = dict(data, fixtures=fixtures)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{brand_key}-prognosen-{data['slug']}.mp4"
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-framerate", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE)
    n = 0
    for frame in cards(b, data):
        proc.stdin.write(frame.tobytes())
        n += 1
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg failed")
    print(f"{out.name}  {n} frames  {n / FPS:.1f}s  "
          f"{out.stat().st_size // 1024} KB  ({len(fixtures)} matches)")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("leagues", nargs="*", type=int)
    ap.add_argument("--brand", choices=list(BRANDS) + ["both"], default="both")
    a = ap.parse_args()
    leagues = a.leagues or [39, 78, 79, 140, 135, 61]
    brands = list(BRANDS) if a.brand == "both" else [a.brand]
    for bk in brands:
        for lid in leagues:
            render(bk, lid)


if __name__ == "__main__":
    main()
