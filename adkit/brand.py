"""Shared drawing for the TippsArena ad videos.

Everything here is built around three facts about a Facebook feed:

  * It plays MUTED. Every word has to be on screen or it was never said, so
    there is no voice-over to write and the captions ARE the script.
  * It is a phone. 1080x1920, and nothing important within 200px of the bottom
    where the platform puts its own buttons.
  * It is scrolled fast. The first frame has to carry the hook - not a logo
    animation, not a title card.

No audio track is written on purpose: he adds trending audio in the app, which
is what the algorithm rewards, and any music I bundled would be somebody's
copyright.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import pathlib
import subprocess

W, H = 1080, 1920
FPS = 30

# His brand, sampled from the logo file - not guessed, and not the lime that
# belonged to the reference site he sent.
ORANGE = (255, 110, 3)
ORANGE_HI = (255, 150, 70)
BG = (11, 15, 20)
WHITE = (245, 248, 251)
GREY = (150, 163, 177)
GREEN = (46, 200, 100)
RED = (230, 70, 60)

# Telegram's own dark theme, so the demo looks like the app it is demonstrating.
TG_BG = (14, 22, 33)
TG_IN = (24, 37, 51)
TG_OUT = (43, 82, 120)

FONTS = "/usr/share/fonts/truetype/lato"
EMOJI_FONT = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
_ROOT = pathlib.Path(__file__).resolve().parent
MARK = _ROOT.parent / "tippsarena-moneyrace" / "public" / "brand" / "mark-white.png"

_cache: dict = {}


def font(size: int, weight: str = "Black") -> ImageFont.FreeTypeFont:
    key = (size, weight)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(f"{FONTS}/Lato-{weight}.ttf", size)
    return _cache[key]


def emoji(char: str, size: int) -> Image.Image:
    """Noto Color Emoji is a bitmap font and only loads at 109px, so it is drawn
    at that size and scaled. Rendering it at the target size silently fails."""
    key = ("emoji", char, size)
    if key not in _cache:
        f = ImageFont.truetype(EMOJI_FONT, 109)
        img = Image.new("RGBA", (140, 140), (0, 0, 0, 0))
        ImageDraw.Draw(img).text((70, 70), char, font=f, anchor="mm", embedded_color=True)
        img = img.crop(img.getbbox() or (0, 0, 140, 140))
        img.thumbnail((size, size), Image.LANCZOS)
        _cache[key] = img
    return _cache[key]


def ease_out(t: float) -> float:
    """Fast then settling. Anything linear reads as a slideshow."""
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_in_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 3 * t * t - 2 * t * t * t


def wrap(draw: ImageDraw.ImageDraw, text: str, f, max_w: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=f) <= max_w or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def caption(
    img: Image.Image,
    text: str,
    y: int,
    size: int = 96,
    colour=WHITE,
    highlight: str | None = None,
    hi_colour=ORANGE,
    max_w: int = 900,
    weight: str = "Black",
    align: str = "mm",
) -> int:
    """Big centred caption, with one phrase allowed to be a different colour.

    Returns the y below the block, so callers can stack without measuring."""
    draw = ImageDraw.Draw(img)
    f = font(size, weight)
    lines = wrap(draw, text, f, max_w)
    lh = int(size * 1.16)
    total = lh * len(lines)
    top = y - total // 2 if align == "mm" else y

    for i, line in enumerate(lines):
        ly = top + i * lh + lh // 2
        if highlight and highlight in line:
            # Draw the line in pieces so the highlighted phrase can be orange
            # without the rest of the line moving.
            before, _, after = line.partition(highlight)
            wb = draw.textlength(before, font=f)
            wh = draw.textlength(highlight, font=f)
            wa = draw.textlength(after, font=f)
            x = (W - (wb + wh + wa)) / 2
            draw.text((x, ly), before, font=f, fill=colour, anchor="lm")
            draw.text((x + wb, ly), highlight, font=f, fill=hi_colour, anchor="lm")
            draw.text((x + wb + wh, ly), after, font=f, fill=colour, anchor="lm")
        else:
            draw.text((W // 2, ly), line, font=f, fill=colour, anchor="mm")
    return top + total


def glow(img: Image.Image, cy: int, strength: float = 1.0,
         rx: int = 560, ry: int = 400, colour=ORANGE) -> None:
    """A soft radial wash behind the content.

    Drawn as one ellipse into a mask and blurred. The first version stacked 28
    concentric ellipses and the banding made it look like a lumpy peanut - a
    blur is both cheaper and actually soft.
    """
    if strength <= 0:
        return
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse(
        (W // 2 - rx, cy - ry, W // 2 + rx, cy + ry), fill=int(150 * strength))
    mask = mask.filter(ImageFilter.GaussianBlur(190))
    img.paste(Image.new("RGB", (W, H), colour), (0, 0), mask)


def rounded(img, box, radius, fill, outline=None, width=0):
    ImageDraw.Draw(img).rounded_rectangle(box, radius=radius, fill=fill,
                                          outline=outline, width=width)


def mark(img: Image.Image, size: int, y: int, alpha: float = 1.0) -> None:
    key = ("mark", size)
    if key not in _cache:
        m = Image.open(MARK).convert("RGBA")
        m.thumbnail((size, size), Image.LANCZOS)
        _cache[key] = m
    m = _cache[key]
    if alpha < 1.0:
        m = m.copy()
        m.putalpha(m.getchannel("A").point(lambda v: int(v * alpha)))
    img.paste(m, ((W - m.width) // 2, y), m)


# ------------------------------------------------------------------ telegram
def phone(
    img: Image.Image,
    bubbles: list[tuple[str, bool, float]],
    top: int = 470,
    now: float = 999.0,
    height: int = 1080,
) -> None:
    """A Telegram chat, drawn rather than screenshotted.

    `bubbles` is (html-less text, is_mine, appears_at_seconds). Each one slides
    up as it appears, the way a real message does, and the stack grows downward
    from `top` - so what the viewer sees is the conversation happening, not a
    finished screenshot of one.
    """
    pad = 62
    body = font(38, "Bold")
    draw = ImageDraw.Draw(img)

    # The handset.
    rounded(img, (pad, top, W - pad, top + height), 52, (20, 28, 38))
    rounded(img, (pad + 10, top + 10, W - pad - 10, top + height - 10), 44, TG_BG)

    # Its title bar, so it is unmistakably Telegram and unmistakably his bot.
    rounded(img, (pad + 10, top + 10, W - pad - 10, top + 108), 44, (23, 33, 43))
    ImageDraw.Draw(img).rectangle(
        (pad + 10, top + 70, W - pad - 10, top + 108), fill=(23, 33, 43))
    ImageDraw.Draw(img).ellipse(
        (pad + 40, top + 32, pad + 96, top + 88), fill=ORANGE)
    draw.text((pad + 118, top + 46), "TippsArena", font=font(34, "Black"), fill=WHITE)
    draw.text((pad + 118, top + 84), "bot", font=font(26, "Regular"), fill=GREY)

    # Measure everything first, then draw from the BOTTOM up. A real chat sits
    # against the bottom of the screen and pushes older messages off the top;
    # filling downward from the header left a third of the handset empty and
    # made the demo look like a screenshot of nothing happening.
    inner = W - pad * 2 - 40
    visible = []
    for text, mine, at in bubbles:
        if now < at:
            break
        f = font(42, "Bold" if mine else "Regular")
        lines = wrap(draw, text, f, inner - 150)
        bw = max(draw.textlength(l, font=f) for l in lines) + 60
        bh = len(lines) * 58 + 44
        visible.append((lines, mine, at, f, bw, bh))

    bottom = top + height - 40
    stack = sum(b[5] + 20 for b in visible)
    y = bottom - stack
    header_end = top + 130
    for lines, mine, at, f, bw, bh in visible:
        # 0.35s of travel, so a message that has been on screen a while is
        # perfectly still and only the newest one moves.
        p = ease_out(min(1.0, (now - at) / 0.35))
        offset = int((1 - p) * 40)
        x = pad + 30 + (inner - bw) if mine else pad + 30
        by = y + offset
        if by + bh > header_end:      # never draw over the chat header
            rounded(img, (x, by, x + bw, by + bh), 22, TG_OUT if mine else TG_IN)
            for i, line in enumerate(lines):
                draw.text((x + 30, by + 22 + i * 58), line, font=f, fill=WHITE)
        y += bh + 20


# ------------------------------------------------------------------ encoding
def encode(frames_dir: pathlib.Path, out: pathlib.Path) -> None:
    """H.264, yuv420p, faststart - what Facebook wants and what every phone
    plays. No audio stream: he adds trending audio in the app."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", str(FPS),
            "-i", str(frames_dir / "%05d.png"),
            "-c:v", "libx264", "-preset", "slow", "-crf", "20",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(out),
        ],
        check=True,
    )
