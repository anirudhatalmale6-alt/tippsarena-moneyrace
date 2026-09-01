#!/usr/bin/env python3
"""Matchday prediction videos, in the style of the TikTok he sent.

    python3 tips_video.py                       # both brands, all six leagues
    python3 tips_video.py --brand tippsarena 78 # one brand, one league

His brief: "the team logos and after 1-2 seconds the imagined result appear",
one video per league, for the upcoming fixtures, plus the same six again for
LuxTipps with a different background and different scores.

The scoreline is never mine. `fetch_tips.py` reads the bookmakers' EXACT SCORE
market out of API-Football and ranks every line by de-margined probability;
TippsArena publishes the most likely one, LuxTipps the second most likely. That
is the only honest way to give two brands different tips on the same fixture -
both are the market's own numbers, and neither is a figure I invented to make
them differ.

The header says PROGNOSE, never FULL TIME. His reference is a results account;
these go out BEFORE kick-off, and a viewer who reads a prediction as a result
will believe the account lies the moment the real score lands.

Frames are piped straight into ffmpeg as raw RGB. Writing 1200 PNGs per video
would be 1.5 GB on disk per file and slower than the drawing itself.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
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


class Brand:
    def __init__(self, key, name, bg, accent, ink, bot, tagline, sub, disc):
        self.key, self.name = key, name
        self.bg, self.accent, self.ink = bg, accent, ink
        self.bot, self.tagline, self.sub = bot, tagline, sub
        self.disc = disc


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


BRANDS = {
    "tippsarena": Brand(
        "tippsarena", "TIPPSARENA",
        bg=(9, 12, 17), accent=P.ORANGE, ink=(10, 13, 17),
        bot="@TippsArenaMoneyrace_bot",
        tagline="JETZT KOSTENLOS MITMACHEN",
        sub="Kostenlos auf Telegram",
        disc=_tippsarena_disc),
    # "different background and different score results" - so it is a different
    # colour family (his own gold avatar, not a recoloured orange), a different
    # texture behind the frame, and the market's SECOND line rather than a
    # number picked to be different.
    "luxtipps": Brand(
        "luxtipps", "LUXTIPPS",
        bg=(6, 7, 10), accent=(235, 189, 87), ink=(12, 10, 6),
        bot="@LuxTippsBot",
        tagline="TAEGLICH NEUE TIPPS",
        sub="Free Channel auf Telegram",
        disc=_lux_disc),
}
BRANDS["luxtipps"].tagline = "TÄGLICH NEUE TIPPS"


# ------------------------------------------------------------------ background
def backdrop(b: Brand) -> Image.Image:
    """One image per video, drawn once. Everything else is composited onto a
    copy of it, which is what makes 1200 frames affordable."""
    img = Image.new("RGB", (W, H), b.bg)
    d = ImageDraw.Draw(img)
    if b.key == "tippsarena":
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
    else:
        glow = Image.new("RGB", (W, H), (0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse((-240, -640, W + 240, 300), fill=(70, 55, 18))
        gd.ellipse((-380, H - 260, W + 380, H + 700), fill=(52, 41, 13))
        img = P._screen(img, glow.filter(ImageFilter.GaussianBlur(215)))
        # Diagonal hairlines - a texture the orange brand does not have, so the
        # two sets are told apart at a glance and not only by hue.
        lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        for x in range(-H, W + H, 46):
            ld.line([(x, 0), (x + H, H)], fill=(235, 189, 87, 12), width=2)
        img = Image.alpha_composite(img.convert("RGBA"), lay).convert("RGB")
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse((-W * 0.34, -H * 0.16, W * 1.34, H * 1.16),
                                 fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(190)).point(lambda v: 255 - v)
    img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0),
              mask.point(lambda v: int(v * 0.85)))
    return img


# ------------------------------------------------------------------- furniture
FRAME = (52, 372, W - 52, 1592)


def chrome(img: Image.Image, b: Brand, league: str, round_label: str) -> None:
    """Logo, league line, the big frame, and the footer. Same on every frame of
    a video, so it is drawn into the backdrop once."""
    d = ImageDraw.Draw(img)
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

    d.text((W / 2, 1690), b.tagline, font=P.font(52, "Black"), fill=P.WHITE,
           anchor="mm")
    d.text((W / 2, 1756), b.bot, font=P.font(46, "Black"), fill=b.accent,
           anchor="mm")
    d.text((W / 2, 1816), b.sub, font=P.font(34, "Bold"), fill=(160, 172, 186),
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
    if crest:
        path = CRESTS / crest
        if path.exists():
            c = Image.open(path).convert("RGBA")
            c = c.resize((int(size * 0.72), int(size * 0.72)), Image.LANCZOS)
            im.paste(c, ((size - c.width) // 2, (size - c.height) // 2), c)
    P._cache[key] = im
    return im


def match_layers(base: Image.Image, b: Brand, fx: dict, alt: bool,
                 index: int = 0, total: int = 0):
    """Everything for one fixture, pre-rendered into three states.

    Returns (still_before, still_after, draw_tiles) - the frames that are not
    inside an animation are copies of one of the first two, which is the whole
    reason a 40-second video renders in seconds rather than minutes.
    """
    tip = fx["alt"] if alt else fx["tip"]
    cx, cy = W // 2, 900
    size = 300
    gap = 118
    lx = cx - gap - size
    rx = cx + gap

    pre = base.copy()
    d = ImageDraw.Draw(pre)
    d.text((cx, 470), "PROGNOSE", font=P.font(104, "Black"), fill=P.WHITE,
           anchor="mm")
    ko = fx["kickoff"][11:16]
    day = _weekday(fx["kickoff"])
    d.text((cx, 552), f"{day} · {ko} UHR", font=P.font(34, "Black"),
           fill=(150, 163, 178), anchor="mm")

    # Names sit UNDER their own tile, not centred on the canvas - a long name
    # next to a short one otherwise drifts across the halfway line.
    fn = P.font(40, "Black")
    for x, name in ((lx, fx["home_short"]), (rx, fx["away_short"])):
        label = name.upper()
        while d.textlength(label, font=fn) > size + 70 and len(label) > 6:
            label = label[:-1]
        d.text((x + size / 2, cy + size / 2 + 62), label, font=fn,
               fill=P.WHITE, anchor="mm")

    if total:
        # A viewer scrolling a 40-second video wants to know how much is left.
        d.text((cx, 1500), f"SPIEL {index} VON {total}", font=P.font(34, "Black"),
               fill=(132, 145, 160), anchor="mm")

    post = pre.copy()
    _score(post, b, tip, 1.0)
    return pre, post, (lx, rx, cy, size, tip)


_DAYS = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"]


def _weekday(iso: str) -> str:
    import datetime as dt
    import zoneinfo
    t = dt.datetime.fromisoformat(iso).astimezone(
        zoneinfo.ZoneInfo("Europe/Berlin"))
    return _DAYS[t.weekday()] + t.strftime(" %d.%m.")


def _score(img: Image.Image, b: Brand, tip: dict, k: float) -> None:
    """The scoreline, punched in at scale `k`."""
    text = f"{tip['home']} : {tip['away']}"
    lay = P.squeeze_text(text, P.font(190, "Black"), P.WHITE, 1.0)
    lay = P.shadowed(lay, 26, 8)
    if k != 1.0:
        lay = lay.resize((max(1, int(lay.width * k)), max(1, int(lay.height * k))),
                         Image.LANCZOS)
    P.glow_behind(img, W // 2, 1330, int(300 * k), int(150 * k), b.accent, 0.45)
    P.paste_c(img, lay, W // 2, 1330)


def _vs(img: Image.Image, b: Brand, cx: int, cy: int, k: float = 1.0) -> None:
    r = int(66 * k)
    d = ImageDraw.Draw(img)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=b.accent)
    if k > 0.55:
        f = P.font(int(46 * k), "Black")
        d.text((cx, cy - 20 * k), "V", font=f, fill=b.ink, anchor="mm")
        d.text((cx, cy + 20 * k), "S", font=f, fill=b.ink, anchor="mm")


# ------------------------------------------------------------------- rendering
def cards(b: Brand, data: dict, alt: bool):
    """Yield every frame of the video, in order, as RGB images."""
    base = backdrop(b)
    chrome(base, b, data["league"], _round_label(data["round"]))

    # --- intro
    intro = base.copy()
    d = ImageDraw.Draw(intro)
    d.text((W / 2, 760), "PROGNOSEN", font=P.font(120, "Black"), fill=P.WHITE,
           anchor="mm")
    d.text((W / 2, 880), "ZUM SPIELTAG", font=P.font(70, "Black"),
           fill=b.accent, anchor="mm")
    d.text((W / 2, 1020), data["league"].upper(), font=P.font(64, "Black"),
           fill=P.WHITE, anchor="mm")
    when = f"{_weekday(data['fixtures'][0]['kickoff'])} – " \
           f"{_weekday(data['fixtures'][-1]['kickoff'])}"
    d.text((W / 2, 1110), when, font=P.font(40, "Bold"), fill=(160, 172, 186),
           anchor="mm")
    d.text((W / 2, 1300), f"{len(data['fixtures'])} SPIELE",
           font=P.font(52, "Black"), fill=b.accent, anchor="mm")
    # Says where the numbers come from, on screen, in the video itself.
    d.text((W / 2, 1500), "Wahrscheinlichste Ergebnisse laut Quotenmarkt",
           font=P.font(30, "Bold"), fill=(132, 145, 160), anchor="mm")
    for _ in range(int(INTRO * FPS)):
        yield intro

    # --- one segment per fixture
    for i, fx in enumerate(data["fixtures"], 1):
        pre, post, (lx, rx, cy, size, tip) = match_layers(
            base, b, fx, alt, i, len(data["fixtures"]))
        lt, rt = tile(fx["home_crest"], size), tile(fx["away_crest"], size)
        n = int(MATCH * FPS)
        for i in range(n):
            t = i / FPS
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
                _score(f, b, tip, 1.55 - 0.55 * p)
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
    d.text((W / 2, 960), "ALLE TIPPS", font=P.font(96, "Black"), fill=P.WHITE,
           anchor="mm")
    d.text((W / 2, 1058), "JEDEN SPIELTAG", font=P.font(70, "Black"),
           fill=b.accent, anchor="mm")
    f = P.font(50, "Black")
    label = b.tagline
    tw = d.textlength(label, font=f)
    bw, bh = tw + 190, 124
    box = ((W - bw) / 2, 1250, (W + bw) / 2, 1250 + bh)
    P.glow_behind(outro, W // 2, 1250 + bh // 2, int(bw * 0.55), int(bh * 1.1),
                  b.accent, 0.30)
    P.pill(outro, box, b.accent)
    dd = ImageDraw.Draw(outro)
    x = (W - (tw + 96)) / 2
    dd.text((x, 1250 + bh / 2 + 2), label, font=f, fill=b.ink, anchor="lm")
    P.arrow(dd, int(x + tw + 46), int(1250 + bh / 2), 44, b.ink)
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
    if not data["fixtures"]:
        raise SystemExit(f"no fixtures with a market for league {league_id}")
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
    for frame in cards(b, data, alt=(brand_key == "luxtipps")):
        proc.stdin.write(frame.tobytes())
        n += 1
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg failed")
    print(f"{out.name}  {n} frames  {n / FPS:.1f}s  "
          f"{out.stat().st_size // 1024} KB  ({len(data['fixtures'])} matches)")
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
