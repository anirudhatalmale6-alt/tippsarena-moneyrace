#!/usr/bin/env python3
"""The MoneyRace image creatives - five messages, three placements, two accents.

    python3 posters.py                 # everything
    python3 posters.py champion        # one motif, all ratios and accents

Written after "Bro i need images, high converting with high ctr rate" and the
reference creative he sent. His two headlines are motifs 1 and 2, word for word,
and every CTA says KOSTENLOS MITMACHEN because he asked for that instead of
MITTIPPEN.

NOT A SINGLE FIGURE IS TYPED HERE. Prize, deadline, match count, fixtures, bot
handle and the channel step all come from `campaign.py`, which reads the live
competition. The three videos from 29 August had the prize baked in as a string
and would have advertised 149,97 EUR for a round that pays 100 EUR.

Each ratio is COMPOSED, not cropped. A 1:1 cut out of a 9:16 loses its headline,
which is the only part of an ad that has to survive.
"""
from __future__ import annotations

import pathlib
import sys
from PIL import Image, ImageDraw

import campaign
import poster as P

C = campaign.load()
OUT = pathlib.Path(__file__).resolve().parent / "out" / "posters"

RATIOS = {"4x5": (1080, 1350), "1x1": (1080, 1080), "9x16": (1080, 1920)}
ACCENTS = {"orange": P.ORANGE, "gruen": P.LIME}

PRIZE = C.prize_text
BOT = "@" + C.bot
DEADLINE = f"{C.lock_day[:2]} {C.lock_local.strftime('%d.%m.')} · {C.lock_clock}"


# --------------------------------------------------------------------- block
class Block:
    """One horizontal band of the poster. Measured before anything is drawn, so
    the stack can be centred and the slack shared out instead of being left at
    the bottom."""

    def __init__(self, height: int, draw, gap: int = 40):
        self.height, self.draw, self.gap = height, draw, gap


class Stack:
    def __init__(self, img: Image.Image, accent):
        self.img, self.accent = img, accent
        self.W, self.H = img.size
        self.blocks: list[Block] = []

    def add(self, b: Block) -> None:
        self.blocks.append(b)

    #: filled in by render() when a stack does not fit. `build` refuses to save
    #: an overflowing poster - the first version of the Platz-1 sheet ran off the
    #: top of the 4:5 canvas and sliced the logo in half, and it took a contact
    #: sheet to see it. Silent overflow is the one layout bug that looks fine in
    #: code and ships broken.
    overflow: int = 0

    def render(self, top: int, bottom: int, extra_cap: int = 90) -> None:
        gaps = [b.gap for b in self.blocks[:-1]]
        total = sum(b.height for b in self.blocks) + sum(gaps)
        room = bottom - top
        if gaps and total > room:
            # Close the gaps as far as they will go before giving up.
            floor = 14
            slack = sum(g - floor for g in gaps if g > floor)
            need = total - room
            if slack > 0:
                take = min(1.0, need / slack)
                gaps = [g - (g - floor) * take if g > floor else g for g in gaps]
                total = sum(b.height for b in self.blocks) + sum(gaps)
            self.overflow = max(0, int(total - room))
        if gaps and total < room:
            # Spread the slack across the gaps rather than growing the type.
            # Growing the type is how a headline ends up bigger than the offer.
            extra = min((room - total) / len(gaps), extra_cap)
            gaps = [g + extra for g in gaps]
            total = sum(b.height for b in self.blocks) + sum(gaps)
        y = top + (room - total) / 2
        for i, b in enumerate(self.blocks):
            b.draw(int(y))
            y += b.height + (gaps[i] if i < len(gaps) else 0)


# -------------------------------------------------------------------- pieces
def lockup(st: Stack, size: int = 96) -> Block:
    """His logo disc plus the wordmark.

    The disc stays ORANGE in the green set too. The accent is a layout choice I
    am offering him; the logo is his brand and recolouring it would quietly
    change the thing he did not ask me to change.
    """
    mark = P.brand_disc(size)
    f = P.font(int(size * 0.62), "Black")
    d = ImageDraw.Draw(st.img)
    word = "TIPPSARENA"
    tw = d.textlength(word, font=f)

    def draw(y: int) -> None:
        row = mark.width + int(size * 0.26) + tw
        x = (st.W - row) / 2
        st.img.paste(mark, (int(x), y), mark)
        d.text((x + mark.width + size * 0.26, y + size / 2 + 2), word, font=f,
               fill=P.WHITE, anchor="lm")

    return Block(size, draw, gap=26)


def eyebrow(st: Stack, words: str) -> Block:
    f = P.font(34, "Black")
    d = ImageDraw.Draw(st.img)

    def draw(y: int) -> None:
        tw = d.textlength(words, font=f)
        x = (st.W - tw) / 2
        d.text((x, y + 22), words, font=f, fill=st.accent, anchor="lm")
        # A rule either side, which is what stops a lone small line looking like
        # a caption somebody forgot to delete.
        for x0, x1 in ((x - 130, x - 30), (x + tw + 30, x + tw + 130)):
            d.line([(x0, y + 22), (x1, y + 22)], fill=(70, 82, 96), width=3)

    return Block(44, draw, gap=34)


def headline(st: Stack, l1: str, l2: str, size: int, l2_accent: bool = True,
             trophy_on: str | None = "l2", l1_accent: bool = False) -> Block:
    """Two lines, the second in the accent colour, both squeezed and sheared.

    The trophy sits to the RIGHT of its line and the line is re-centred around
    the pair, so the emoji never pushes the words off centre."""
    f = P.font(size, "BlackItalic")
    lay1 = P.squeeze_text(l1, f, st.accent if l1_accent else P.WHITE)
    lay2 = P.squeeze_text(l2, f, st.accent if l2_accent else P.WHITE)
    lay1 = P.shadowed(lay1, size * 0.10, int(size * 0.05))
    lay2 = P.shadowed(lay2, size * 0.10, int(size * 0.05))
    tr = P.trophy(int(size * 1.05)) if trophy_on else None
    lh = int(size * 0.99)

    def draw(y: int) -> None:
        for i, lay in enumerate((lay1, lay2)):
            cy = y + int(size * 0.52) + i * lh
            want = ("l1", "l2")[i]
            if tr is not None and trophy_on == want:
                # The emoji was overlapping the question mark in the first
                # render. `lay` carries the shadow padding, so the visible edge
                # is inset - the gap is measured from the INK box, not the layer.
                ink = lay.getchannel("A").getbbox()
                right_pad = lay.width - ink[2]
                gap = int(size * 0.10)
                total = ink[2] + gap + tr.width
                x = (st.W - total) / 2 - ink[0]
                st.img.paste(lay, (int(x), int(cy - lay.height / 2)), lay)
                st.img.paste(tr, (int(x + lay.width - right_pad + gap),
                                  int(cy - tr.height * 0.52)), tr)
            else:
                P.paste_c(st.img, lay, st.W // 2, cy)
        # The underline swoosh from his reference, under the accent line.
        d = ImageDraw.Draw(st.img)
        uy = y + int(size * 0.52) + lh + int(size * 0.56)
        half = min(st.W * 0.34, lay2.width * 0.40)
        d.line([(st.W / 2 - half, uy), (st.W / 2 + half, uy)],
               fill=st.accent, width=max(5, int(size * 0.055)))

    return Block(int(size * 1.05) + lh, draw, gap=44)


def subline(st: Stack, words, size: int = 40) -> Block:
    """`words` may be a list, and for anything that wraps it should be: letting
    the wrapper choose put "AUF." alone on line two of the first render."""
    f = P.font(size, "Black")
    d = ImageDraw.Draw(st.img)
    if isinstance(words, (list, tuple)):
        lines = [w.upper() for w in words]
    else:
        lines = P.wrap(d, words.upper(), f, int(st.W * 0.90))
    lh = int(size * 1.30)

    def draw(y: int) -> None:
        for i, line in enumerate(lines):
            d.text((st.W / 2, y + lh * i + lh / 2), line, font=f,
                   fill=(216, 226, 236), anchor="mm")

    return Block(lh * len(lines), draw, gap=40)


def cta(st: Stack, label: str = "JETZT KOSTENLOS MITMACHEN") -> Block:
    """The one thing the whole poster is for. Accent fill, dark type - a hollow
    outlined button on a photograph is invisible at thumbnail size."""
    f = P.font(52, "Black")
    d = ImageDraw.Draw(st.img)
    h = 132
    tw = d.textlength(label, font=f)
    inner = tw + 40 + 56
    w = min(st.W - 90, inner + 130)

    def draw(y: int) -> None:
        box = ((st.W - w) / 2, y, (st.W + w) / 2, y + h)
        P.glow_behind(st.img, st.W // 2, y + h // 2, int(w * 0.55), int(h * 1.1),
                      st.accent, 0.30)
        P.pill(st.img, box, st.accent)
        dd = ImageDraw.Draw(st.img)
        x = (st.W - inner) / 2
        dd.text((x, y + h / 2 + 2), label, font=f, fill=P.INK, anchor="lm")
        P.arrow(dd, int(x + tw + 46), int(y + h / 2), 46, P.INK)

    return Block(h, draw, gap=34)


def footer(st: Stack) -> Block:
    """Telegram disc + NUR AUF TELEGRAM + the REAL handle."""
    f1 = P.font(34, "Black")
    f2 = P.font(36, "Black")
    d = ImageDraw.Draw(st.img)
    tg = P.telegram(62)
    w1 = d.textlength("NUR AUF TELEGRAM", font=f1)

    def draw(y: int) -> None:
        row = tg.width + 20 + w1
        x = (st.W - row) / 2
        st.img.paste(tg, (int(x), y), tg)
        d.text((x + tg.width + 20, y + tg.height / 2), "NUR AUF TELEGRAM",
               font=f1, fill=(200, 212, 224), anchor="lm")
        d.text((st.W / 2, y + 96), BOT, font=f2, fill=st.accent, anchor="mm")

    return Block(122, draw, gap=30)


# --------------------------------------------------------------- body panels
def prize_panel(st: Stack) -> Block:
    """Prize, then the three numbers that say how small the ask is."""
    fb = P.font(150, "Black")
    fl = P.font(40, "Black")
    fn = P.font(58, "Black")
    fk = P.font(28, "Black")
    h = 400

    def draw(y: int) -> None:
        box = (60, y, st.W - 60, y + h)
        P.card(st.img, box, radius=44, outline=(46, 57, 70), width=3)
        d = ImageDraw.Draw(st.img)
        lay = P.squeeze_text(PRIZE, fb, st.accent, 0.92)
        P.paste_c(st.img, lay, st.W // 2, y + 118)
        d.text((st.W / 2, y + 226), "FÜR DEN BESTEN TIPP", font=fl,
               fill=(206, 218, 230), anchor="mm")
        d.line([(120, y + 272), (st.W - 120, y + 272)], fill=(46, 57, 70), width=3)
        cols = ((C.match_count, "SPIELE"), (C.match_count, "TIPPS"),
                (C.winner_count, "GEWINNER"))
        for i, (num, lab) in enumerate(cols):
            cx = st.W * (0.26 + 0.24 * i)
            d.text((cx, y + 320), str(num), font=fn, fill=P.WHITE, anchor="mm")
            d.text((cx, y + 366), lab, font=fk, fill=(150, 164, 180), anchor="mm")

    return Block(h, draw, gap=44)


def rank_panel(st: Stack, rows: int = 3, compact: bool = False) -> Block:
    """His reference showed 47 / 43 / 39 points and "49. DU".

    His database has two participants and no finished competition, so that board
    does not exist. This one says the podium is empty - which is true, and is a
    better reason to tap than someone else's score."""
    # 4:5 and 1:1 have to carry the same headline in less canvas, so the panel
    # gives up the height, not the type. 1:1 also drops to two podium rows -
    # three squeezed rows and a squeezed CTA is worse than two clear ones.
    head, rh, pill_h = (88, 70, 84) if compact else (108, 86, 96)
    note = 0 if rows < 3 else (52 if compact else 78)
    h = head + rows * rh + pill_h + note

    def draw(y: int) -> None:
        box = (60, y, st.W - 60, y + h)
        P.card(st.img, box, radius=44, outline=(46, 57, 70), width=3)
        d = ImageDraw.Draw(st.img)
        d.text((st.W / 2, y + head * 0.50), "MONEYRACE · RANGLISTE",
               font=P.font(34, "Black"), fill=(160, 174, 190), anchor="mm")
        d.line([(110, y + head - 16), (st.W - 110, y + head - 16)],
               fill=(42, 52, 65), width=3)
        for i in range(rows):
            ry = y + head + i * rh
            md = P.medal(58, i + 1)
            st.img.paste(md, (120, int(ry + rh / 2 - 29)), md)
            # An empty name is drawn as a blank bar, not as a row of dashes.
            # Dashes look like a font that failed; a bar reads as "not filled
            # in yet", which is what it is.
            bw = (280, 230, 200)[i]
            P.pill(st.img, (200, ry + rh / 2 - 17, 200 + bw, ry + rh / 2 + 17),
                   (44, 55, 68), radius=17)
            right = PRIZE if i == 0 else "–"
            d.text((st.W - 120, ry + rh / 2), right, font=P.font(44, "Black"),
                   fill=st.accent if i == 0 else (74, 88, 104), anchor="rm")
        by = y + head + rows * rh + 10
        P.pill(st.img, (110, by, st.W - 110, by + pill_h - 12), (26, 34, 44), radius=22)
        d.text((150, by + (pill_h - 12) / 2), "DEIN PLATZ", font=P.font(40, "Black"),
               fill=(206, 218, 230), anchor="lm")
        d.text((st.W - 150, by + (pill_h - 12) / 2), "NOCH FREI", font=P.font(40, "Black"),
               fill=st.accent, anchor="rm")
        # Says out loud why the board is empty. Without this an empty table can
        # be read as "nobody plays this", which is the opposite of the point.
        if note:
            d.text((st.W / 2, by + pill_h + note * 0.45),
                   f"Die Rangliste entscheidet sich am {C.lock_day}.",
                   font=P.font(32, "Bold"), fill=(150, 164, 180), anchor="mm")

    return Block(h, draw, gap=40)


def fixtures_panel(st: Stack, limit: int | None = None) -> Block:
    """The real fixtures of the live round. Somebody who knows the Bundesliga
    can check these against the schedule, which is exactly the point."""
    items = C.fixtures[:limit] if limit else C.fixtures
    more = len(C.fixtures) - len(items)
    rh = 72
    h = 100 + len(items) * rh + (60 if more else 14)

    def draw(y: int) -> None:
        box = (60, y, st.W - 60, y + h)
        P.card(st.img, box, radius=44, outline=(46, 57, 70), width=3)
        d = ImageDraw.Draw(st.img)
        head = f"{C.league.upper()} · {C.lock_local.strftime('%d.%m.%Y')}"
        d.text((st.W / 2, y + 52), head, font=P.font(34, "Black"),
               fill=(160, 174, 190), anchor="mm")
        d.line([(110, y + 88), (st.W - 110, y + 88)], fill=(42, 52, 65), width=3)
        f = P.font(42, "Black")
        for i, fx in enumerate(items):
            ry = y + 100 + i * rh + rh / 2
            d.text((130, ry), fx["home_short"], font=f, fill=P.WHITE, anchor="lm")
            d.text((st.W / 2, ry), "–", font=f, fill=st.accent, anchor="mm")
            d.text((st.W - 130, ry), fx["away_short"], font=f, fill=P.WHITE,
                   anchor="rm")
        if more:
            d.text((st.W / 2, y + h - 38), f"+ {more} weitere",
                   font=P.font(30, "Black"), fill=(130, 145, 162), anchor="mm")

    return Block(h, draw, gap=40)


def tick_panel(st: Stack) -> Block:
    """The four objections a German reader has about a football tipping ad, in
    the order they occur to them. The channel line is only true because
    requires_membership is on - it is read, never assumed."""
    items = ["Kein Einsatz, kein Wettschein",
             f"{C.matches_worded} tippen, {C.tips_worded} abgeben",
             f"{PRIZE} für den besten Tipp",
             "Läuft komplett in Telegram"]
    if C.requires_membership:
        items[3] = "Kanal beitreten, dann tippen"
    rh = 92
    h = len(items) * rh

    def draw(y: int) -> None:
        d = ImageDraw.Draw(st.img)
        f = P.font(46, "Black")
        for i, s in enumerate(items):
            ry = y + i * rh
            P.card(st.img, (60, ry, st.W - 60, ry + rh - 14), radius=26,
                   outline=(44, 55, 68), width=2)
            ck = P.check(52, st.accent)
            st.img.paste(ck, (110, int(ry + (rh - 14) / 2 - 26)), ck)
            d.text((190, ry + (rh - 14) / 2), s, font=f, fill=P.WHITE, anchor="lm")

    return Block(h, draw, gap=40)


def deadline_panel(st: Stack) -> Block:
    """A DATE, never a countdown. A counter is wrong the second it is exported;
    5. September is still 5. September tomorrow."""
    h = 300

    def draw(y: int) -> None:
        box = (60, y, st.W - 60, y + h)
        P.card(st.img, box, radius=44, outline=(46, 57, 70), width=3)
        d = ImageDraw.Draw(st.img)
        d.text((st.W / 2, y + 54), "TIPPSCHLUSS", font=P.font(34, "Black"),
               fill=(160, 174, 190), anchor="mm")
        big = f"{C.lock_day.upper()} · {C.lock_clock.replace(' Uhr', '')}"
        lay = P.squeeze_text(big, P.font(96, "Black"), st.accent, 0.88)
        P.paste_c(st.img, lay, st.W // 2, y + 150)
        d.text((st.W / 2, y + 236), f"{C.lock_date} · {C.matches_worded}",
               font=P.font(42, "Black"), fill=(206, 218, 230), anchor="mm")

    return Block(h, draw, gap=40)


# -------------------------------------------------------------------- motifs
def build(motif: str, ratio: str, accent_name: str) -> Image.Image:
    w, h = RATIOS[ratio]
    tall = h / w
    img = P.stadium(w, h, seed=11)
    P.scrim(img, top=0.46 if tall > 1.4 else 0.40,
            bottom=0.42 if tall > 1.4 else 0.36)
    st = Stack(img, ACCENTS[accent_name])

    # Headline size per placement. 1:1 has the least room and the headline is
    # still the thing that must survive, so the BODY panel shrinks instead.
    hs = {"9x16": 104, "4x5": 100, "1x1": 88}[ratio]
    fx_limit = {"9x16": None, "4x5": None, "1x1": 3}[ratio]
    show_sub = ratio != "1x1"
    show_eyebrow = ratio != "1x1"
    st.add(lockup(st, 96 if tall > 1.05 else 82))

    if motif == "champion":
        if show_eyebrow:
            st.add(eyebrow(st, "BUNDESLIGA MONEYRACE"))
        st.add(headline(st, "WER WIRD", "TIPPSARENA CHAMPION?", hs - 8,
                        trophy_on="l1"))
        if show_sub:
            st.add(subline(st, ["Tippe. Sammle Punkte.", "Steige im Ranking auf."]))
        st.add(prize_panel(st))
    elif motif == "platz1":
        if show_eyebrow:
            st.add(eyebrow(st, "BUNDESLIGA MONEYRACE"))
        st.add(headline(st, "SCHAFFST DU ES", "AUF PLATZ 1?", hs, trophy_on="l2"))
        if show_sub:
            st.add(subline(st, ["Tippe. Sammle Punkte.", "Steige im Ranking auf."]))
        st.add(rank_panel(st, rows=2 if ratio == "1x1" else 3,
                          compact=ratio != "9x16"))
    elif motif == "preisgeld":
        if show_eyebrow:
            st.add(eyebrow(st, f"TIPPSCHLUSS {DEADLINE}"))
        st.add(headline(st, PRIZE, "FÜR DEN BESTEN TIPP.", hs, l2_accent=False,
                        trophy_on=None, l1_accent=True))
        if show_sub:
            st.add(subline(st, f"{C.matches_worded}. {C.tips_worded}. "
                               f"{C.winner_count} Gewinner."))
        st.add(fixtures_panel(st, fx_limit))
    elif motif == "kein-wettschein":
        if show_eyebrow:
            st.add(eyebrow(st, "MONEYRACE"))
        st.add(headline(st, "KEIN WETTSCHEIN.", "KEIN EINSATZ.", hs,
                        trophy_on=None))
        if show_sub:
            st.add(subline(st, f"Ein kostenloses Tippspiel um {PRIZE}."))
        st.add(tick_panel(st))
    elif motif == "tippschluss":
        if show_eyebrow:
            st.add(eyebrow(st, "BUNDESLIGA MONEYRACE"))
        st.add(headline(st, f"{PRIZE} GEWINNEN.", "BIS SAMSTAG TIPPEN.", hs - 6,
                        trophy_on=None))
        if show_sub:
            st.add(subline(st, "Danach ist zu. Ohne Ausnahme."))
        st.add(deadline_panel(st))
    else:
        raise SystemExit(f"unknown motif {motif}")

    st.add(cta(st))
    st.add(footer(st))

    # Stories and Reels put their own UI over the top ~14% and bottom ~20%.
    if ratio == "9x16":
        st.render(250, h - 330)
    elif ratio == "1x1":
        st.render(46, h - 46, extra_cap=40)
    else:
        st.render(56, h - 56)
    if st.overflow:
        # Never save one. The first Platz-1 sheet ran 120px off the top and
        # sliced the logo in half, and it took a contact sheet to notice.
        raise SystemExit(f"OVERFLOW {motif}/{ratio}/{accent_name}: "
                         f"{st.overflow}px [{' '.join(str(b.height) for b in st.blocks)}]")
    return img


MOTIFS = ["champion", "platz1", "preisgeld", "kein-wettschein", "tippschluss"]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or MOTIFS
    for m in wanted:
        for accent in ACCENTS:
            for ratio in RATIOS:
                img = build(m, ratio, accent)
                path = OUT / f"tippsarena-{m}-{accent}-{ratio}.jpg"
                img.save(path, quality=92, subsampling=0)
                print(path.name, img.size)


if __name__ == "__main__":
    main()
