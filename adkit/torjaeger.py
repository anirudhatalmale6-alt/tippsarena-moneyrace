#!/usr/bin/env python3
"""TippsArena: "Torjäger <Saison> - ohne Elfmeter", one video per league.

The whole point of the video is the gap between the two rankings. A penalty is
a goal, but it is not the same evidence about a striker, and the official top
scorer list mixes them. Take the penalties out and the table moves - in Spain
it changes hands entirely.

Every number on screen is derived at render time from `data/topscorers-*.json`,
the provider's untouched response. Nothing here is typed by hand: not a goal
count, not a club, not a name. The three "story" cards (which player loses the
most, whether the crown changes hands) are COMPUTED from the same rows, so this
script renders any league without me deciding what its story is.

German on purpose - this is what a player reads.
No audio track, same as the ad kit: he adds trending audio in the app.

Run:  python3 torjaeger.py                      # all five, running season
      python3 torjaeger.py 78 140               # only these league ids
      SEASON=2024 python3 torjaeger.py          # the 2024/25 set

The season must have been fetched first - `SEASON=2024 python3 fetch_scorers.py`
- because the completeness proof belongs to the fetch, not to the render.
"""
from PIL import Image, ImageDraw
from datetime import date
import json
import os
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from brand import (  # noqa: E402
    W, H, FPS, ORANGE, BG, WHITE, GREY, GREEN,
    caption, ease_out, encode, font, glow, mark, rounded, wrap,
)

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "out"
SCRATCH = pathlib.Path(
    "/tmp/claude-1004/-home-freelancer/9dbe74e0-4297-4b96-ba61-8a7c42919c50"
    "/scratchpad/frames"
)

# API-Football numbers a season by the year it STARTS. The label is derived,
# not typed, so "2024" can never be captioned "2024/24" or "2025/26".
SEASON = int(os.environ.get("SEASON", "2025"))
SEASON_LABEL = f"{SEASON}/{(SEASON + 1) % 100:02d}"

# The season currently being played. A finished season has a final table and
# saying "Stand <today>" about it would suggest it is still moving; a running
# one has no final table and must not be captioned as though it had.
CURRENT_SEASON = 2025
FINAL = SEASON < CURRENT_SEASON
FETCHED = date.today().strftime("%d.%m.%Y")

BOT = "@TippsArenaMoneyrace_bot"

# The five files fetch_scorers.py writes, and the German name of each league.
LEAGUES = {
    78: ("Bundesliga", "Deutschland"),
    39: ("Premier League", "England"),
    140: ("La Liga", "Spanien"),
    135: ("Serie A", "Italien"),
    61: ("Ligue 1", "Frankreich"),
}

CARD = (23, 31, 41)
CARD_HI = (38, 30, 22)


# --------------------------------------------------------------------- data
def _from_events(ev: dict, ts: dict) -> list[dict]:
    """Every goal of the season, counted one at a time.

    Only `Normal Goal` and `Penalty` are goals. `Own Goal` belongs to nobody's
    tally, and `Missed Penalty` - which this provider also files under
    `type: "Goal"` - is not a goal at all.

    The club shown is the one he scored MOST of them for, so a January transfer
    is described by where the goals came from rather than by where he ended up.
    Names come from the topscorers list because the event list's are dirty.
    """
    clean = {p["player"]["id"]: p["player"]["name"] for p in ts["response"]}
    npg: dict[int, int] = {}
    pens: dict[int, int] = {}
    clubs: dict[int, dict[str, int]] = {}
    dirty: dict[int, str] = {}
    for fx in ev["fixtures"]:
        for e in fx["events"]:
            if e["type"] != "Goal" or e["detail"] not in ("Normal Goal", "Penalty"):
                continue
            pid = e["player"]["id"]
            if pid is None:
                continue
            if e["detail"] == "Normal Goal":
                npg[pid] = npg.get(pid, 0) + 1
            else:
                pens[pid] = pens.get(pid, 0) + 1
            clubs.setdefault(pid, {})
            team = e["team"]["name"]
            clubs[pid][team] = clubs[pid].get(team, 0) + 1
            dirty.setdefault(pid, (e["player"]["name"] or "").strip())

    rows = []
    for pid in set(npg) | set(pens):
        name = clean.get(pid)
        if name is None:
            # Not in the provider's own top-20 list. That is not a reason to
            # drop him - Ferran Torres is exactly this case - but the name has
            # to be cleaned and the substitution said out loud.
            name = " ".join(dirty[pid].split())
            name = name.lstrip("0123456789 ").strip() or f"#{pid}"
        rows.append({
            "name": name,
            "team": max(clubs[pid], key=clubs[pid].get),
            "total": npg.get(pid, 0) + pens.get(pid, 0),
            "pens": pens.get(pid, 0),
            "npg": npg.get(pid, 0),
        })
    return rows


def load(league: int) -> list[dict]:
    """Provider rows -> the only shape the renderer knows about.

    `rank_total` is kept because the story of the video is the DIFFERENCE
    between the two rankings, and you cannot show a difference you did not
    keep both halves of.

    COUNTED FROM THE GOALS THEMSELVES when `events-<league>-<season>.json`
    exists, and only from `players/topscorers` when it does not. The two
    disagreed, and the aggregate was the one that was wrong:

      * `statistics[0]` is ONE CLUB. A player who moved in January had half a
        season counted - and for Gouiri the provider returned two identical
        10-goal blocks, which no reading of `statistics[0]` can rescue.
      * Lewandowski came back one goal short of the 27 he actually won the
        Pichichi with, and Greenwood one too many.
      * The top-20-by-total list is not even complete: Ferran Torres scored 10
        non-penalty goals in La Liga and is not in it, which is also why the
        old completeness proof in `fetch_scorers.py` proved something true
        about a list that was itself missing somebody.

    Counting individual goal events has none of those failure modes: a goal
    belongs to whichever club he scored it for, and there is no list to fall
    off the end of.
    """
    ev_path = DATA / f"events-{league}-{SEASON}.json"
    body = json.loads((DATA / f"topscorers-{league}-{SEASON}.json").read_text())

    if ev_path.exists():
        rows = _from_events(json.loads(ev_path.read_text()), body)
    else:
        print(f"  ! no {ev_path.name} - falling back to season totals, which "
              f"undercount transferred players", file=sys.stderr)
        rows = []
        for p in body["response"]:
            s = p["statistics"][0]
            total = s["goals"]["total"] or 0
            pens = s["penalty"]["scored"] or 0
            rows.append({
                "name": p["player"]["name"],
                "team": s["team"]["name"],
                "total": total,
                "pens": pens,
                "npg": total - pens,
            })

    by_total = sorted(rows, key=lambda r: (-r["total"], r["name"]))
    for i, r in enumerate(by_total, 1):
        r["rank_total"] = i
    by_npg = sorted(rows, key=lambda r: (-r["npg"], -r["total"], r["name"]))
    for i, r in enumerate(by_npg, 1):
        r["rank_npg"] = i
    return by_npg


def glowed(cy: int, strength: float = 1.0, rx: int = 560, ry: int = 400):
    """`glow` blurs a full-size mask, which is far too slow to do on every one
    of a thousand frames. The wash never animates, so it is drawn once."""
    key = (cy, strength, rx, ry)
    if key not in _bg_cache:
        img = Image.new("RGB", (W, H), BG)
        glow(img, cy, strength, rx, ry)
        _bg_cache[key] = img
    return _bg_cache[key].copy()


_bg_cache: dict = {}


def fit(draw, text: str, size: int, weight: str, max_w: int, floor: int = 22):
    """Shrink until it fits rather than truncating or hand-abbreviating.

    'Borussia Mönchengladbach' is a real club with a long name; inventing a
    short form for it is one more place a club could come out wrong.
    """
    while size > floor:
        f = font(size, weight)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    return font(floor, weight)


# -------------------------------------------------------------------- pieces
def header(img: Image.Image, league_name: str, country: str) -> None:
    d = ImageDraw.Draw(img)
    d.text((W // 2, 236), country.upper(), font=font(30, "Bold"),
           fill=GREY, anchor="mm")
    f = fit(d, league_name.upper(), 78, "Black", 900)
    d.text((W // 2, 300), league_name.upper(), font=f, fill=WHITE, anchor="mm")
    d.text((W // 2, 372), f"TORJÄGER {SEASON_LABEL}", font=font(44, "Black"),
           fill=WHITE, anchor="mm")
    d.text((W // 2, 432), "OHNE ELFMETER", font=font(52, "Black"),
           fill=ORANGE, anchor="mm")
    d.text((W // 2, 486), "Alle Tore außer Elfmeter", font=font(28, "Regular"),
           fill=GREY, anchor="mm")


def row_strip(r: dict, place: int, best: int, grow: float, count: int) -> Image.Image:
    """One table row, drawn into its own transparent strip so it can slide and
    fade in without the rows under it being redrawn."""
    h = 108
    s = Image.new("RGBA", (W, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    x0, x1 = 70, W - 70
    top = place == 1

    d.rounded_rectangle((x0, 4, x1, h - 8), radius=18, fill=CARD_HI if top else CARD)
    # The card IS the bar: the fill width is the player's share of the leader's
    # tally, so the table and the chart are the same object.
    bar_w = int((x1 - x0 - 8) * (r["npg"] / best) * grow)
    if bar_w > 24:
        d.rounded_rectangle((x0 + 4, 8, x0 + 4 + bar_w, h - 12), radius=14,
                            fill=(96, 45, 10) if top else (36, 46, 60))
    if top:
        d.rounded_rectangle((x0, 4, x0 + 10, h - 8), radius=5, fill=ORANGE)

    d.text((x0 + 46, h // 2 - 2), str(place), font=font(40, "Black"),
           fill=ORANGE if top else GREY, anchor="mm")

    name_f = fit(d, r["name"], 42, "Black", 460)
    d.text((x0 + 88, 34), r["name"], font=name_f, fill=WHITE, anchor="lm")

    sub = (f"{r['total']} Tore · {r['pens']} Elfmeter" if r["pens"]
           else f"{r['total']} Tore · kein Elfmeter")
    team_f = fit(d, r["team"], 26, "Bold", 330)
    d.text((x0 + 88, 76), r["team"], font=team_f, fill=GREY, anchor="lm")
    tw = d.textlength(r["team"], font=team_f)
    d.text((x0 + 108 + tw, 76), sub, font=font(24, "Regular"),
           fill=(255, 150, 70) if r["pens"] else (110, 170, 130), anchor="lm")

    d.text((x1 - 34, h // 2 - 2), str(count), font=font(56, "Black"),
           fill=ORANGE if top else WHITE, anchor="rm")
    return s


def footer(img: Image.Image) -> None:
    ImageDraw.Draw(img).text(
        (W // 2, H - 210), "TIPPSARENA · Kostenlos · Kein Einsatz · Ab 18",
        font=font(28, "Bold"), fill=(92, 102, 114), anchor="mm")


def swap_card(img: Image.Image, t: float, old: dict, new: dict) -> None:
    """Only rendered when taking the penalties out changes who is top.

    Both cards print the SAME measure - goals without penalties - big. The
    first draft put the official 25 against the new 18 and the card read as
    though the smaller number had won an argument; the comparison the video is
    making is 17 against 18, so that is the pair that has to be side by side.
    """
    d = ImageDraw.Draw(img)
    caption(img, "OHNE ELFMETER", 300, size=54, colour=GREY, weight="Bold")
    caption(img, "hat die Liga einen", 380, size=54, colour=WHITE, weight="Bold")
    caption(img, "anderen Torjäger", 452, size=62, colour=ORANGE)

    def block(y, r, label, colour, bg):
        rounded(img, (90, y, W - 90, y + 250), 22, bg)
        d.text((130, y + 46), label, font=font(26, "Bold"), fill=GREY)
        nf = fit(d, r["name"], 58, "Black", 560)
        d.text((130, y + 122), r["name"], font=nf, fill=colour, anchor="lm")
        d.text((130, y + 192), f"{r['total']} Tore · {r['pens']} Elfmeter",
               font=font(30, "Bold"), fill=GREY, anchor="lm")
        d.text((W - 130, y + 130), str(r["npg"]), font=font(96, "Black"),
               fill=colour, anchor="rm")
        d.text((W - 130, y + 196), "ohne Elfmeter", font=font(24, "Bold"),
               fill=GREY, anchor="rm")

    if t > 0.3:
        block(620, old, "OFFIZIELLER TORSCHÜTZENKÖNIG", WHITE, CARD)
    if t > 1.3:
        # Lato has no ▼; the first render put a tofu box in the middle of the
        # card. Drawn, so it cannot depend on a glyph being present.
        d.polygon([(W // 2 - 26, 918), (W // 2 + 26, 918), (W // 2, 958)],
                  fill=ORANGE)
        block(990, new, "OHNE ELFMETER GANZ OBEN", ORANGE, CARD_HI)
    if t > 2.4:
        caption(img, f"{new['npg']} zu {old['npg']}", 1370, size=72,
                colour=ORANGE)
        caption(img, "Elfmeter verschieben", 1460, size=44, colour=WHITE,
                weight="Bold")
        caption(img, "die ganze Torjägerliste.", 1516, size=44, colour=WHITE,
                weight="Bold")
    footer(img)


def pens_card(img: Image.Image, t: float, worst: list[dict]) -> None:
    """The three players in the top 20 who owe the most to the spot."""
    d = ImageDraw.Draw(img)
    caption(img, "DIE MEISTEN", 330, size=48, colour=GREY, weight="Bold")
    caption(img, "ELFMETER-TORE", 404, size=68, colour=ORANGE)
    caption(img, f"Saison {SEASON_LABEL}", 476, size=32, colour=GREY,
            weight="Bold")

    for i, r in enumerate(worst):
        if t < 0.35 + i * 0.65:
            continue
        y = 640 + i * 320
        rounded(img, (90, y, W - 90, y + 250), 22, CARD)
        nf = fit(d, r["name"], 52, "Black", 560)
        d.text((130, y + 70), r["name"], font=nf, fill=WHITE, anchor="lm")
        tf = fit(d, r["team"], 28, "Bold", 560)
        d.text((130, y + 126), r["team"], font=tf, fill=GREY, anchor="lm")
        d.text((130, y + 194), f"{r['pens']} Elfmeter", font=font(34, "Black"),
               fill=(255, 150, 70), anchor="lm")
        d.text((W - 130, y + 96), str(r["total"]), font=font(64, "Black"),
               fill=GREY, anchor="rm")
        d.text((W - 130, y + 168), f"→ {r['npg']}", font=font(58, "Black"),
               fill=ORANGE, anchor="rm")
        d.text((W - 130, y + 216), "Tore ohne Elfmeter", font=font(22, "Bold"),
               fill=GREY, anchor="rm")
    footer(img)


def cta(img: Image.Image, t: float, league_name: str) -> None:
    mark(img, 240, 330, alpha=min(1.0, t / 0.4))
    caption(img, "TIPPSARENA", 660, size=72, colour=WHITE)
    caption(img, "MONEYRACE", 740, size=72, colour=ORANGE)
    if t > 0.5:
        caption(img, f"Tippe die {league_name}.", 900, size=52,
                colour=WHITE, weight="Bold")
    if t > 1.1:
        caption(img, "Spiele um echtes Preisgeld.", 970, size=52,
                colour=WHITE, weight="Bold")
    if t > 1.8:
        p = ease_out(min(1.0, (t - 1.8) / 0.4))
        bw = int(760 * p)
        rounded(img, ((W - bw) // 2, 1120, (W + bw) // 2, 1250), 30, ORANGE)
        if p > 0.85:
            caption(img, "KOSTENLOS MITTIPPEN", 1185, size=44, colour=(12, 12, 12))
    if t > 2.6:
        caption(img, BOT, 1340, size=40, colour=GREY, weight="Bold")
    footer(img)


# ------------------------------------------------------------------ timeline
def build(league: int):
    league_name, country = LEAGUES[league]
    rows = load(league)
    top10 = rows[:10]
    best = top10[0]["npg"]

    leader_total = min(rows, key=lambda r: r["rank_total"])   # official top scorer
    leader_npg = top10[0]
    crown_changes = leader_total["name"] != leader_npg["name"]

    worst = sorted(rows, key=lambda r: (-r["pens"], -r["total"]))[:3]

    # The hook is ALWAYS the league's official top scorer - the name the viewer
    # already knows - and there are two true things to say about him. Picking
    # instead whoever took the most penalties gave Serie A a hook about a
    # 10-goal striker while the actual story sat in plain sight: Lautaro's 17
    # with not one from the spot.
    scenes = []

    def s_hook(t):
        img = glowed(760, 0.9)
        caption(img, leader_total["name"], 470, size=64, colour=GREY,
                weight="Bold")
        caption(img, f"{leader_total['total']}", 720, size=260, colour=WHITE)
        caption(img, "TORE", 880, size=56, colour=GREY, weight="Bold")
        if leader_total["pens"]:
            if t > 1.4:
                caption(img, f"{leader_total['pens']} davon vom Elfmeterpunkt.",
                        1120, size=54, colour=WHITE, weight="Bold")
            if t > 2.6:
                caption(img, f"Bleiben {leader_total['npg']}.", 1260, size=76,
                        colour=ORANGE)
            if t > 3.5:
                caption(img, "Wer ist wirklich vorne?", 1400, size=48,
                        colour=WHITE, weight="Bold")
        else:
            if t > 1.4:
                caption(img, "Kein einziger Elfmeter.", 1120, size=58,
                        colour=ORANGE)
            if t > 2.6:
                caption(img, "Bei anderen sieht das", 1250, size=48,
                        colour=WHITE, weight="Bold")
                caption(img, "ganz anders aus.", 1310, size=48,
                        colour=WHITE, weight="Bold")
            if t > 3.5:
                caption(img, "Die Tabelle ohne Elfmeter:", 1440, size=46,
                        colour=WHITE, weight="Bold")
        footer(img)
        return img
    scenes.append((4.8, s_hook))

    # --- the table -----------------------------------------------------------
    STEP, ROW_H = 1.05, 112

    def s_table(t):
        img = Image.new("RGB", (W, H), BG)
        header(img, league_name, country)
        for i, r in enumerate(top10):
            at = i * STEP
            if t < at:
                break
            p = ease_out(min(1.0, (t - at) / 0.45))
            grow = ease_out(min(1.0, (t - at) / 0.55))
            count = max(1, round(r["npg"] * min(1.0, (t - at) / 0.55)))
            strip = row_strip(r, i + 1, best, grow, count)
            if p < 1.0:
                strip.putalpha(strip.getchannel("A").point(
                    lambda v, p=p: int(v * p)))
            # 536 + 9*112 + 108 = 1652, and the footer sits at 1710. The first
            # cut ran the tenth row straight through it.
            img.paste(strip, (int((1 - p) * 70), 536 + i * ROW_H), strip)
        footer(img)
        return img
    scenes.append((STEP * 10 + 2.6, s_table))

    # --- what the penalties were hiding -------------------------------------
    if crown_changes:
        scenes.append((5.0, lambda t: (
            lambda img: (swap_card(img, t, leader_total, leader_npg), img)[1]
        )(glowed(560, 0.55))))

    scenes.append((4.8, lambda t: (
        lambda img: (pens_card(img, t, worst), img)[1]
    )(glowed(560, 0.5))))

    # --- where the numbers came from ----------------------------------------
    def s_source(t):
        img = Image.new("RGB", (W, H), BG)
        caption(img, "Alle Zahlen aus der", 820, size=44, colour=GREY,
                weight="Bold")
        caption(img,
                f"{'Endtabelle' if FINAL else 'Saisonstatistik'} {SEASON_LABEL}",
                890, size=44, colour=WHITE, weight="Bold")
        caption(img, f"Datenquelle: API-Football · abgerufen {FETCHED}", 990,
                size=32, colour=GREY, weight="Regular")
        footer(img)
        return img
    scenes.append((2.4, s_source))

    scenes.append((5.4, lambda t: (
        lambda img: (cta(img, t, league_name), img)[1]
    )(glowed(700, 1.0))))

    return scenes, sum(d for d, _ in scenes)


def frame(scenes, f: int) -> Image.Image:
    t = f / FPS
    for dur, fn in scenes:
        if t < dur:
            return fn(t)
        t -= dur
    return scenes[-1][1](scenes[-1][0] - 0.001)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    wanted = {int(a) for a in sys.argv[1:] if a.isdigit()} or set(LEAGUES)
    for league in LEAGUES:
        if league not in wanted:
            continue
        slug = LEAGUES[league][0].lower().replace(" ", "-")
        name = f"tippsarena-torjaeger-{slug}-{SEASON_LABEL.replace('/', '-')}"
        scenes, seconds = build(league)
        frames = SCRATCH / name
        if frames.exists():
            shutil.rmtree(frames)
        frames.mkdir(parents=True)
        total = int(seconds * FPS)
        for f in range(total):
            frame(scenes, f).save(frames / f"{f:05d}.png")
            if f % 150 == 0:
                print(f"  {name}: {f}/{total}", flush=True)
        mp4 = OUT / f"{name}.mp4"
        encode(frames, mp4)
        shutil.rmtree(frames)
        print(f"{mp4.name}  {mp4.stat().st_size / 1e6:.2f} MB  {seconds:.1f}s",
              flush=True)
