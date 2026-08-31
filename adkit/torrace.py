#!/usr/bin/env python3
"""Torjaeger ohne Elfmeter - the bar race, Spieltag by Spieltag.

Built to match the reference post: a warm dark background, the season number
ghosted behind the title, an orange pill for the league and an outlined one for
"OHNE ELFMETER", a Spieltag counter, and a stack of bars that grow and overtake
each other, each carrying its club crest, the player's photo riding the end of
its bar, and a badge saying what he did THAT matchday.

Where the numbers come from
---------------------------
`data/events-<league>-<season>.json` - every goal event of every fixture of the
season, exactly as the provider returned it. A goal counts for this video only
if `type == "Goal"` and `detail == "Normal Goal"`. That excludes three things
that all arrive as `type: "Goal"`:

  * `Penalty`      - a scored penalty, the whole point of "ohne Elfmeter"
  * `Missed Penalty` - not a goal at all, and it is in this data
  * `Own Goal`     - a goal, but not the scorer's

Names come from `data/topscorers-<league>-<season>.json` because the event list
carries dirty ones ("1                         F. Wirtz"). Everything is keyed
on the numeric player id.

The cast is the season's FINAL top N by non-penalty goals, tracked from
Spieltag 1 - the same thing the reference does, which is why players sit on 0
in its first frame. A race over "whoever leads today" would swap the whole
cast every week and be unreadable.

Run:  SEASON=2024 python3 torrace.py 78
      SEASON=2024 ROWS=8 python3 torrace.py 78 39 140 135 61
"""
from PIL import Image, ImageDraw, ImageFilter
import colorsys
import json
import os
import pathlib
import shutil
import sys
import urllib.request

from brand import (W, H, FPS, ORANGE, WHITE, GREY, font, ease_in_out, encode,
                   rounded)

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
IMG = DATA / "img"
OUT = ROOT / "out"

SEASON = int(os.environ.get("SEASON", "2024"))
SEASON_LABEL = f"{SEASON}/{(SEASON + 1) % 100:02d}"
# Six, because that is what the published videos on his Instagram use. Eight
# was my own invention and it is the reason my rows sat tighter than his.
ROWS = int(os.environ.get("ROWS", "6"))

# "The lines should be moving not the football players" turned out to be about
# the badge column, not the ordering: in his own earlier videos the column of
# matchday badges slides across the board from right to left, and for part of
# every matchday two of them are on screen at once. Mine was nailed to a fixed
# x, so nothing on the board moved except the players. LANES=fixed was a wrong
# guess at that sentence and is kept only as an escape hatch - the reference
# re-sorts, so "sort" is the house style.
LANES = os.environ.get("LANES", "sort")

LEAGUES = {
    78: ("Bundesliga", "bundesliga"),
    39: ("Premier League", "premier-league"),
    140: ("La Liga", "la-liga"),
    135: ("Serie A", "serie-a"),
    61: ("Ligue 1", "ligue-1"),
}

# Warm and dark, so a white photo cut-out and an orange pill both sit on it.
BG_EDGE = (22, 13, 9)
BG_MID = (62, 34, 22)
BADGE_ON = (46, 200, 100)
BADGE_OFF = (58, 44, 36)
BAR_DIM = (120, 92, 78)

# --------------------------------------------------------------- layout
BAR_X = 168                 # every bar starts here
BAR_MAX = 612               # and the longest one ends here
ROW_TOP = 726               # the board always fills the same band, whatever
ROW_BOTTOM = 1538           # ROWS is, so the footer never drifts
ROW_PITCH = (ROW_BOTTOM - ROW_TOP) / (ROWS - 1) if ROWS > 1 else 0.0
# Bar, photo and type all follow the pitch, capped so six rows do not grow
# into each other. At ROWS=8 these come out at the old 78/52/1.0 exactly.
_S = min(1.25, ROW_PITCH / 116)
BAR_H = int(min(112, ROW_PITCH * 0.68))
PHOTO_R = int(min(62, ROW_PITCH * 0.45))

# A matchday's badge column is born at AXIS_X, on the right, and slides this
# far left over that matchday - so the column before it is still leaving the
# board on the left while the new one arrives. Measured off his own videos.
AXIS_X = 985
AXIS_TRAVEL = 575
FOOT_Y = 1712

_cache: dict = {}


# ------------------------------------------------------------------ assets
def _download(url: str, path: pathlib.Path) -> pathlib.Path | None:
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            body = r.read()
    except Exception:                                  # noqa: BLE001
        return None
    if len(body) < 200:                                # an error page, not a png
        return None
    path.write_bytes(body)
    return path


def photo(player_id: int) -> Image.Image | None:
    key = ("photo", player_id)
    if key not in _cache:
        p = _download(f"https://media.api-sports.io/football/players/{player_id}.png",
                      IMG / "players" / f"{player_id}.png")
        _cache[key] = _circle(p, PHOTO_R * 2) if p else None
    return _cache[key]


def crest(team_id: int) -> Image.Image | None:
    key = ("crest", team_id)
    if key not in _cache:
        p = _download(f"https://media.api-sports.io/football/teams/{team_id}.png",
                      IMG / "teams" / f"{team_id}.png")
        if p:
            c = Image.open(p).convert("RGBA")
            c.thumbnail((72, 72), Image.LANCZOS)
            _cache[key] = c
        else:
            _cache[key] = None
    return _cache[key]


def _circle(path: pathlib.Path, d: int) -> Image.Image:
    """A head shot cropped to a circle with a white ring, the way the reference
    has them. The source is a square with the player centred, so a plain
    centre-crop is right - anything cleverer would cut heads off."""
    src = Image.open(path).convert("RGBA")
    side = min(src.size)
    src = src.crop(((src.width - side) // 2, 0, (src.width + side) // 2, side))
    src = src.resize((d, d), Image.LANCZOS)
    mask = Image.new("L", (d * 4, d * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, d * 4 - 1, d * 4 - 1), fill=255)
    mask = mask.resize((d, d), Image.LANCZOS)          # anti-aliased edge
    out = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    out.paste(Image.new("RGBA", (d, d), WHITE + (255,)), (0, 0), mask)
    inner = Image.new("L", (d, d), 0)
    ImageDraw.Draw(inner).ellipse((5, 5, d - 6, d - 6), fill=255)
    inner = inner.filter(ImageFilter.GaussianBlur(0.6))
    out.paste(src, (0, 0), inner)
    return out


# Crests that carry no colour at all. Mönchengladbach's is pure black, white
# and grey at the size the provider serves it, so no amount of sampling will
# find its green - I checked the pixels rather than assuming the sampler was
# broken. These are the only hand-written values in the kit, and they are
# deliberately a different kind of thing from the numbers: a club colour is a
# brand fact, and nothing a viewer is asked to believe depends on it.
CLUB_COLOUR_OVERRIDE = {
    163: (0, 166, 81),      # Borussia Mönchengladbach - green
}
NO_COLOUR = (122, 104, 92)  # a neutral, so a miss never looks like a decision


def club_colour(team_id: int) -> tuple[int, int, int]:
    """The bar takes the club's colour, sampled from its own crest rather than
    typed into a table - a hand-written colour for every club in five leagues
    is ~98 values I would have to be right about, and one of them would be
    wrong.

    Picked as the most-saturated colour with enough pixels behind it; black,
    white and grey are skipped because almost every crest is mostly outline.
    A crest with no colour in it at all falls through to the override table,
    and says so, because a silent fallback is a wrong bar nobody notices.
    """
    key = ("colour", team_id)
    if key in _cache:
        return _cache[key]
    if team_id in CLUB_COLOUR_OVERRIDE:
        _cache[key] = CLUB_COLOUR_OVERRIDE[team_id]
        return _cache[key]
    p = crest(team_id)
    fallback = NO_COLOUR
    if p is None:
        print(f"  ! no crest for team {team_id}, bar will be neutral",
              file=sys.stderr)
        _cache[key] = fallback
        return fallback
    small = p.convert("RGBA").resize((48, 48), Image.LANCZOS)
    buckets: dict[tuple[int, int, int], int] = {}
    for r, g, b, a in small.getdata():
        if a < 200:
            continue
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < 0.35 or l < 0.16 or l > 0.88:           # grey, near-black, near-white
            continue
        buckets[(r // 24, g // 24, b // 24)] = buckets.get((r // 24, g // 24, b // 24), 0) + 1
    if not buckets:
        print(f"  ! team {team_id}: crest has no colour to sample, using a "
              f"neutral bar - add it to CLUB_COLOUR_OVERRIDE", file=sys.stderr)
        _cache[key] = fallback
        return fallback
    r, g, b = max(buckets, key=buckets.get)
    r, g, b = r * 24 + 12, g * 24 + 12, b * 24 + 12
    # Lift it until it reads against the dark background; a navy club would
    # otherwise be a bar you cannot see.
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    l = max(l, 0.42)
    s = max(s, 0.55)
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    _cache[key] = (int(r * 255), int(g * 255), int(b * 255))
    return _cache[key]


# ------------------------------------------------------------------ the data
def surname(full: str) -> str:
    """What goes on the bar. "Tim Kleindienst" -> "KLEINDIENST"; an initialled
    name like "T. Kleindienst" gives the same answer, which is the point."""
    parts = [p for p in full.replace(" ", " ").split() if p]
    parts = [p for p in parts if not (len(p) <= 2 and p.endswith("."))]
    return (parts[-1] if parts else full).upper()


def load(league: int) -> dict:
    ev_path = DATA / f"events-{league}-{SEASON}.json"
    if not ev_path.exists():
        raise SystemExit(f"missing {ev_path} - run fetch_season.py {league} first")
    ev = json.loads(ev_path.read_text())

    names: dict[int, str] = {}
    ts_path = DATA / f"topscorers-{league}-{SEASON}.json"
    if ts_path.exists():
        for p in json.loads(ts_path.read_text())["response"]:
            names[p["player"]["id"]] = p["player"]["name"]

    md = ev["matchdays"]
    # per player: goals in each matchday, and the club he scored them for
    tally: dict[int, list[int]] = {}
    club: dict[int, dict[int, int]] = {}
    dirty: dict[int, str] = {}
    for fx in ev["fixtures"]:
        for e in fx["events"]:
            # Only these are goals for this video. `Penalty` is excluded on
            # purpose, `Missed Penalty` is not a goal at all, `Own Goal` is not
            # the scorer's.
            if e["type"] != "Goal" or e["detail"] != "Normal Goal":
                continue
            pid = e["player"]["id"]
            if pid is None:
                continue
            tally.setdefault(pid, [0] * (md + 1))[fx["round"]] += 1
            club.setdefault(pid, {})
            club[pid][e["team"]["id"]] = club[pid].get(e["team"]["id"], 0) + 1
            dirty.setdefault(pid, e["player"]["name"] or "")

    totals = {pid: sum(v) for pid, v in tally.items()}
    top = sorted(totals, key=lambda p: (-totals[p], surname(names.get(p) or dirty[p])))[:ROWS]

    players = []
    for pid in top:
        clean = names.get(pid)
        if clean is None:
            # The event list is the only name left, and it is the dirty one.
            # Say so rather than printing it silently.
            clean = dirty[pid]
            print(f"  ! no clean name for player {pid}, falling back to "
                  f"the event list: {clean!r}", file=sys.stderr)
        players.append({
            "id": pid,
            "name": surname(clean),
            "team": max(club[pid], key=club[pid].get),
            "per_round": tally[pid],
            "total": totals[pid],
        })

    return {"league": league, "name": ev["league_name"], "matchdays": md,
            "players": players}


def boards(players: list[dict], matchdays: int) -> list[list[dict]]:
    """Every matchday's ordering, matchday 0 (all on zero) through the last.

    A TIE KEEPS THE ORDER IT ALREADY HAD. That is the whole reason this is one
    function over the season rather than a sort per matchday: ranking each
    matchday independently and breaking ties by name made Burkardt jump above
    Kleindienst the moment he drew LEVEL with him, which on screen is
    indistinguishable from an overtake. A row may now only move when somebody
    actually goes past somebody. The first ordering has to come from somewhere,
    so matchday 0 - where everyone is on nothing - is seeded with the season's
    FINAL table. That is what his own videos do: on their matchday 1 the four
    players still on zero are stacked in the order they eventually finish, and
    seeding it this way reproduces that frame exactly.
    """
    out: list[list[dict]] = []
    final = {p["id"]: sum(p["per_round"]) for p in players}
    order = sorted(players, key=lambda p: (-final[p["id"]], p["name"]))
    prev_index = {p["id"]: i for i, p in enumerate(order)}
    for k in range(matchdays + 1):
        rows = [{**p,
                 "value": sum(p["per_round"][:k + 1]),
                 "delta": p["per_round"][k] if k >= 1 else 0}
                for p in players]
        rows.sort(key=lambda r: (-r["value"], prev_index[r["id"]]))
        prev_index = {r["id"]: i for i, r in enumerate(rows)}
        out.append(rows)
    return out


# ------------------------------------------------------------------ drawing
def background() -> Image.Image:
    key = "bg"
    if key not in _cache:
        img = Image.new("RGB", (W, H), BG_EDGE)
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).ellipse((-260, 240, W + 260, H - 120), fill=210)
        mask = mask.filter(ImageFilter.GaussianBlur(220))
        img.paste(Image.new("RGB", (W, H), BG_MID), (0, 0), mask)
        # The reference has a fine dot texture over it. Drawn, not tiled from a
        # file, so there is nothing to ship alongside the script.
        dots = ImageDraw.Draw(img)
        for y in range(120, H, 26):
            for x in range(14 if (y // 26) % 2 else 0, W, 26):
                dots.point((x, y), fill=(255, 210, 180))
        _cache[key] = img
    return _cache[key].copy()


def pill(img, text, cy, size, fill, text_colour, outline=None, pad=34):
    d = ImageDraw.Draw(img)
    f = font(size, "Black")
    w = d.textlength(text, font=f)
    h = int(size * 1.55)
    box = ((W - w) / 2 - pad, cy - h / 2, (W + w) / 2 + pad, cy + h / 2)
    rounded(img, box, h // 2, fill, outline=outline, width=4 if outline else 0)
    d.text((W / 2, cy + 1), text, font=f, fill=text_colour, anchor="mm")


def header(img: Image.Image, league_name: str, label: str) -> None:
    d = ImageDraw.Draw(img)
    # The season number, ghosted, sitting behind the title pill.
    ghost = Image.new("RGBA", (W, 260), (0, 0, 0, 0))
    ImageDraw.Draw(ghost).text((W / 2, 130), SEASON_LABEL, font=font(168, "Black"),
                               fill=(255, 255, 255, 52), anchor="mm")
    img.paste(ghost, (0, 262), ghost)

    pill(img, f"{league_name.upper()} TOP-TORSCHÜTZEN", 452, 46, ORANGE, WHITE)
    pill(img, "OHNE ELFMETER", 546, 38, None, ORANGE, outline=ORANGE, pad=30)
    d.text((W / 2, 640), label, font=font(54, "Black"), fill=WHITE, anchor="mm")


def footer(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    from brand import MARK
    key = "footmark"
    if key not in _cache:
        m = Image.open(MARK).convert("RGBA")
        m.thumbnail((96, 96), Image.LANCZOS)
        _cache[key] = m
    m = _cache[key]
    word = "TIPPSARENA"
    f = font(58, "Black")
    ww = d.textlength(word, font=f)
    total = m.width + 22 + ww
    x = (W - total) / 2
    img.paste(m, (int(x), FOOT_Y - m.height // 2), m)
    d.text((x + m.width + 22, FOOT_Y - 6), word, font=f, fill=WHITE, anchor="lm")
    d.text((W / 2, FOOT_Y + 52), "tippsarena.com", font=font(30, "Black"),
           fill=ORANGE, anchor="mm")


def draw_row(img: Image.Image, row: dict, y: float, value: float, scale: float,
             appear: float) -> None:
    """One player. `value` is the animated goal count, `scale` the animated
    denominator, so both the bar's growth and the axis rescaling are smooth."""
    d = ImageDraw.Draw(img)
    y = int(y)
    colour = club_colour(row["team"])

    c = crest(row["team"])
    if c is not None:
        img.paste(c, (70 - c.width // 2 + 36, y - c.height // 2), c)

    # A player on zero still gets a stub in his club's colour - the reference
    # does the same, and it is what keeps a row readable before he has scored.
    # The floor is wide enough to be seen next to the photo that sits on it.
    bar_w = max(18.0, BAR_MAX * (value / scale)) if scale > 0 else 18.0
    end = BAR_X + bar_w
    # Two rows swapping places pass through each other, and for the few frames
    # they overlap the flat colours merge into one unreadable block. A hard
    # shadow under the bar is enough to keep the edge of the upper one visible.
    radius = min(int(16 * _S), int(bar_w / 2))
    rounded(img, (BAR_X, y - BAR_H // 2 + 7, end + 5, y + BAR_H // 2 + 7),
            radius, (18, 10, 7))
    rounded(img, (BAR_X, y - BAR_H // 2, end, y + BAR_H // 2), radius, colour)

    f_name = font(int(40 * _S), "Black")
    f_tab = font(int(26 * _S), "Black")
    f_num = font(int(62 * _S), "Black")
    num = f"{int(round(value))}"
    num_w = d.textlength(num, font=f_num)
    tab_w = int(40 * _S)

    p = photo(row["id"])
    px = end + PHOTO_R          # the photo rides just past the bar's tip
    # A bar long enough to carry its own label gets the surname in a white tab
    # at its end and the count inside it, which is what leaves the middle of
    # every bar empty for the badge column to slide across. Short bars fall
    # back to count and name printed after the photo, as the reference does.
    inside = bar_w >= tab_w + num_w + 58
    if inside:
        rounded(img, (end - tab_w, y - BAR_H // 2, end, y + BAR_H // 2), 4,
                (247, 249, 250))
        _vtext(img, row["name"], end - tab_w / 2, y, tab_w, BAR_H, f_tab)
        d.text((end - tab_w - 20, y + 2), num, font=f_num, fill=_on(colour),
               anchor="rm")
    else:
        nx = px + PHOTO_R + 16
        d.text((nx, y + 2), num, font=f_num, fill=WHITE, anchor="lm")
        d.text((nx + num_w + 18, y + 2), row["name"], font=f_name,
               fill=WHITE, anchor="lm")

    if p is not None:
        img.paste(p, (int(px - PHOTO_R), y - PHOTO_R), p)


def _vtext(img: Image.Image, text: str, cx: float, cy: float, w: int, h: int,
           f) -> None:
    """A surname printed up the side of the tab at the bar's end. Rendered flat
    and rotated, then shrunk if the name is longer than the bar is tall."""
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lay = Image.new("RGBA", (int(probe.textlength(text, font=f)) + 10, int(w)),
                    (0, 0, 0, 0))
    ImageDraw.Draw(lay).text((lay.width / 2, lay.height / 2), text, font=f,
                             fill=(24, 18, 14), anchor="mm")
    lay = lay.rotate(90, expand=True)
    if lay.height > h - 10:
        lay = lay.resize((max(1, round(lay.width * (h - 10) / lay.height)),
                          h - 10))
    img.paste(lay, (round(cx - lay.width / 2), round(cy - lay.height / 2)), lay)


def draw_column(img: Image.Image, ax: float, ys: list[tuple[float, int]],
                alpha: float) -> None:
    """One matchday's badges, threaded on their own vertical line, at wherever
    that line has slid to. Drawn into a narrow RGBA strip so the whole column
    can fade in as it arrives and out as it leaves without touching the bars
    it passes over."""
    r = int(32 * _S)
    x0 = int(ax) - r - 6
    strip = Image.new("RGBA", (2 * r + 12, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(strip)
    cx = ax - x0
    d.line((cx, ROW_TOP - 46, cx, ROW_BOTTOM + 46), fill=(196, 124, 54), width=5)
    for y, delta in ys:
        got = delta > 0
        d.ellipse((cx - r, y - r, cx + r, y + r),
                  fill=BADGE_ON if got else BADGE_OFF)
        d.text((cx, y + 1), f"+{delta}" if got else "0",
               font=font(int((32 if got else 34) * _S), "Black"),
               fill=WHITE if got else (150, 128, 112), anchor="mm")
    if alpha < 1.0:
        strip.putalpha(strip.getchannel("A").point(
            lambda v: int(v * max(0.0, alpha))))
    img.paste(strip, (x0, 0), strip)


def column_alpha(ax: float) -> float:
    """Fades up over the first 70px of travel and out as it runs off the left,
    so a column never pops into or out of existence mid-board."""
    a = 0.25 + 0.75 * min(1.0, (AXIS_X - ax) / 70.0)
    if ax < 40:
        a *= max(0.0, (ax + 60) / 100.0)
    return a


def _on(bg: tuple[int, int, int]) -> tuple[int, int, int]:
    """Black or white text, whichever the bar can actually be read against."""
    lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255
    return (16, 12, 10) if lum > 0.62 else WHITE


# ------------------------------------------------------------------ timeline
INTRO = 2.2
MOVE = 0.46
HOLD = 0.30
FINAL_HOLD = 3.4


def build(league: int) -> pathlib.Path:
    data = load(league)
    md = data["matchdays"]
    name, slug = LEAGUES[league]
    players = data["players"]

    board = boards(players, md)

    print(f"{name} {SEASON_LABEL}: {md} matchdays, top {len(players)} "
          f"ohne Elfmeter", flush=True)
    for i, p in enumerate(board[md], 1):
        print(f"  {i:2d}. {p['name']:<14} {p['total']:2d}", flush=True)

    step = MOVE + HOLD
    total = INTRO + step * md + FINAL_HOLD
    frames_dir = pathlib.Path(
        os.environ.get("FRAMES", "/tmp")) / f"torrace-{os.getpid()}-{league}"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)

    # Every matchday's ordering is computed once; a frame only interpolates.
    # The bar scale follows the current leader with a floor, so matchday 1 is
    # not eight invisible stubs and matchday 34 still fills the width.
    scale_at = [max(4.0, max(r["value"] for r in board[k])) for k in range(md + 1)]

    # In fixed-lane mode a player's row never changes, so it is decided once,
    # from the final standings, instead of from the matchday being drawn.
    lane = {r["id"]: j for j, r in enumerate(board[md])}

    # What each matchday's badge column carries, kept per matchday because a
    # column stays on screen well after its own matchday has been applied.
    delta_at = [{r["id"]: r["delta"] for r in board[j]} for j in range(md + 1)]

    n = int(total * FPS)
    for i in range(n):
        t = i / FPS
        img = background()

        if t < INTRO:
            k, u, slide = 0, 0.0, None
            appear = min(1.0, t / 1.0)
            label = "SPIELTAG 1"
        else:
            x = (t - INTRO) / step
            k = min(md, int(x) + 1)                # matchday being moved INTO
            u = min(1.0, (x - int(x)) / (MOVE / step))
            if t >= INTRO + step * md:
                k, u = md, 1.0
            appear = 1.0
            label = f"SPIELTAG {k}" if k < md else f"ENDSTAND · {md}. SPIELTAG"
            # The columns slide on wall-clock, not on the row easing, so they
            # keep drifting through the hold instead of stopping with the bars.
            slide = x - (k - 1)

        prev = board[k - 1] if k >= 1 else board[0]
        cur = board[k]
        e = ease_in_out(u)
        scale = scale_at[k - 1] + (scale_at[k] - scale_at[k - 1]) * e if k >= 1 \
            else scale_at[0]

        pos_prev = {r["id"]: j for j, r in enumerate(prev)}
        val_prev = {r["id"]: r["value"] for r in prev}

        header(img, name, label)

        # Where every row has got to this frame, worked out before anything is
        # drawn because the badge columns have to thread through the same ys.
        placed = []
        for j, row in reversed(list(enumerate(cur))):
            if LANES == "fixed":
                y = ROW_TOP + lane[row["id"]] * ROW_PITCH
            else:
                y0 = ROW_TOP + pos_prev[row["id"]] * ROW_PITCH
                y1 = ROW_TOP + j * ROW_PITCH
                y = y0 + (y1 - y0) * e
            placed.append((row, y))

        # This matchday's column, plus the one before it still leaving on the
        # left. Off-board columns are dropped rather than drawn transparent.
        cols = []
        if slide is not None:
            for back in (1, 0):
                kk = k - back
                if kk < 1:
                    continue
                ax = AXIS_X - AXIS_TRAVEL * (slide + back)
                if -80 < ax <= AXIS_X + 1:
                    cols.append((kk, ax))

        # Drawn worst rank first, so during a swap the player moving UP is the
        # one painted on top. The overlap then reads as the overtake it is,
        # instead of the promoted player disappearing behind the man he passed.
        for row, y in placed:
            v0 = val_prev[row["id"]]
            v = v0 + (row["value"] - v0) * e
            draw_row(img, row, y, v, scale, appear)
        for kk, ax in cols:
            draw_column(img, ax,
                        [(y, delta_at[kk].get(row["id"], 0))
                         for row, y in placed],
                        column_alpha(ax))
        footer(img)

        img.save(frames_dir / f"{i:05d}.png")
        if i % 120 == 0:
            print(f"  frame {i}/{n}", flush=True)

    suffix = "-v2" if LANES == "fixed" else ""
    out = OUT / (f"tippsarena-torjaeger-race-{slug}-"
                 f"{SEASON_LABEL.replace('/', '-')}{suffix}.mp4")
    OUT.mkdir(exist_ok=True)
    encode(frames_dir, out)
    shutil.rmtree(frames_dir)
    print(f"  -> {out} ({out.stat().st_size / 1e6:.2f} MB, {total:.1f}s)", flush=True)
    return out


if __name__ == "__main__":
    wanted = [int(a) for a in sys.argv[1:]] or list(LEAGUES)
    for lg in wanted:
        build(lg)
