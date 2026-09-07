"""Verify the ENCODED files, not the intent.

For each video: ffprobe geometry/audio/frames, then pull a real frame out of
the mp4 at the moment a chosen fixture's score is on screen and compare it to
the frame the code draws for that same fixture.

New in v3, and the reason this run OCRs: three of his five notes are about text
that must NOT be on screen (the bot handle, the odds, the title card), plus one
about text that must be in the right LANGUAGE. Reading the source to confirm a
draw call was deleted proves nothing about the file he will play - so every
sampled frame is read back with tesseract and checked against a forbidden list.
"""
import json, pathlib, re, subprocess, sys
sys.path.insert(0, "/var/lib/freelancer/projects/40523265/adkit")
from PIL import Image, ImageChops, ImageStat
import pytesseract
import tips_video as T

DATA = T.DATA
ALL = [(2,"champions-league"),(39,"premier-league"),(78,"bundesliga"),
       (79,"bundesliga-2"),(140,"la-liga"),(135,"serie-a"),(61,"ligue-1")]
# `python3 verify_tips.py 2` checks one league. Without an argument it checks
# the six weekend leagues, which is what the September package was.
_want = [int(a) for a in sys.argv[1:]]
LEAGUES = [x for x in ALL if x[0] in _want] if _want else ALL[1:]
TMP = pathlib.Path("/tmp/claude-1004/-home-freelancer/9dbe74e0-4297-4b96-ba61-8a7c42919c50/scratchpad/vfy")
TMP.mkdir(exist_ok=True)
BAND = (5.0, 20.0)

# On no frame of either brand: a handle, or a printed price.
# A bare "@" is not usable: tesseract reads the Inter, Napoli and Mainz crests
# as "@" or "@)", and then joins them to the club name on the same line - "@
# OSASUNA". A handle has no space in it, so the space is the discriminator.
HANDLE = re.compile(r"@[A-Z][A-Z0-9_]{2,}")
FORBIDDEN = ["QUOTE", "QUOTENMARKT", "MONEYRACE_BOT", "LUXTIPPSBOT",
             "TELEGRAM", "MITMACHEN", "KOSTENLOS",
             "PROGNOSEN", "ZUM SPIELTAG", "SPIELE ·", "5.00", "20.00"]
# On no frame of LuxTipps: German. (Not "TIPPS" - LUXTIPPS contains it.)
GERMAN = ["SPIELTAG", "SPIEL ", "PROGNOSE", "UHR", "JEDEN", "ALLE ", "VON ",
          "ERGEBNIS", "MITTWOCH", "SAMSTAG"]
fails = []


def probe(p):
    out = subprocess.run(["ffprobe","-v","error","-show_entries",
        "stream=width,height,nb_frames,codec_type","-of","json",str(p)],
        capture_output=True, text=True).stdout
    return json.loads(out)["streams"]


def grab(p, t, dest):
    subprocess.run(["ffmpeg","-y","-loglevel","error","-ss",f"{t:.3f}",
                    "-i",str(p),"-frames:v","1",str(dest)], check=True)
    return Image.open(dest).convert("RGB")


def ocr(im):
    return " " + re.sub(r"\s+", " ", pytesseract.image_to_string(im).upper()) + " "


def check(brand, b, d, fx, p, slug):
    """One encoded file. `fx` is the fixture list THAT file was rendered from -
    the whole round for the round video, one night for a day cut. Re-deriving
    it in here from the json is what the caller is for; doing it twice is how a
    day cut ends up checked against the round's frame count."""
    st = probe(p)
    vid = [s for s in st if s["codec_type"]=="video"]
    aud = [s for s in st if s["codec_type"]=="audio"]
    # No title card any more: frame one is fixture one.
    want = len(fx)*int(T.MATCH*T.FPS) + int(T.OUTRO*T.FPS)
    got = int(vid[0]["nb_frames"])
    if aud: fails.append(f"{p.name}: has {len(aud)} audio stream(s)")
    if (vid[0]["width"],vid[0]["height"]) != (T.W,T.H):
        fails.append(f"{p.name}: {vid[0]['width']}x{vid[0]['height']}")
    if got != want: fails.append(f"{p.name}: {got} frames, expected {want}")

    # data rules
    seen = {}
    for f in fx:
        pick = f["picks"][brand]
        if not (BAND[0] <= pick["odds"] <= BAND[1]):
            fails.append(f"{p.name}: {f['home_short']}-{f['away_short']} "
                         f"odds {pick['odds']} outside 5-20")
        seen[pick["score"]] = seen.get(pick["score"],0)+1
        if brand == "luxtipps" and pick["score"] == f["picks"]["tippsarena"]["score"]:
            fails.append(f"{p.name}: {f['home_short']} same score as TippsArena")
    # A repeat is only a bug if the picker HAD an alternative. With ten
    # fixtures, a twelve-deep in-band pool and the other brand holding one
    # line per match, running out is possible and legitimate - so the test
    # is whether an unused, in-band, non-colliding line existed at that
    # point, not whether a repeat occurred.
    counts, forced = {}, []
    for f in fx:
        sc = f["picks"][brand]["score"]
        if counts.get(sc):
            other = f["picks"].get("tippsarena", {}).get("score") \
                if brand == "luxtipps" else None
            alt = [c["score"] for c in f["cands"][:12]
                   if BAND[0] <= c["odds"] <= BAND[1]
                   and c["score"] != other and not counts.get(c["score"])]
            if alt:
                fails.append(f"{p.name}: {f['home_short']} repeated {sc} "
                             f"with {alt} still free")
            else:
                forced.append(f"{f['home_short']}={sc}")
        counts[sc] = counts.get(sc, 0) + 1

    # ---- OCR sweep: frame 1, every settled match frame, the outro
    stops = [0.05] + [i*T.MATCH + T.REVEAL + 0.9 for i in range(len(fx))]
    stops.append(len(fx)*T.MATCH + 1.5)
    hits = set()
    first_txt = ""
    for k, t in enumerate(stops):
        im = grab(p, t, TMP/f"{brand}-{slug}-{k}.png")
        txt = ocr(im)
        if k == 0:
            first_txt = txt.strip()
        for w in FORBIDDEN:
            if w in txt: hits.add((round(t,1), w))
        m = HANDLE.search(txt)
        if m: hits.add((round(t,1), m.group(0)))
        if brand == "luxtipps":
            for w in GERMAN:
                if w in txt: hits.add((round(t,1), w))
    if hits:
        fails.append(f"{p.name}: forbidden text on screen {sorted(hits)}")
    # Frame one must already be INSIDE match 1, not a title card. The team
    # names cannot be the test - in the light layout they are still sliding
    # in at 0.05 s - so the test is the match counter, which only the fixture
    # segments draw.
    if b.t("counter", i=1, n=len(fx)) not in first_txt:
        fails.append(f"{p.name}: frame 1 is not match 1 "
                     f"- got {first_txt[:80]!r}")

    # ---- pixel proof: middle fixture, one second after its reveal
    i = max(1, len(fx)//2)
    t = (i-1)*T.MATCH + T.REVEAL + 0.8
    shot = grab(p, t, TMP/f"{brand}-{slug}-proof.png")
    base = T.backdrop(b); T.chrome(base, b, d["league"], T._round_label(d["round"], b))
    if b.style == "light":
        _, ref, _, _ = T.match_layers_light(base, b, fx[i-1], i, len(fx))
    else:
        _, ref, (lx,rx,cy,size,tip) = T.match_layers_dark(base, b, fx[i-1], i, len(fx))
        lt, rt = T.tile(fx[i-1]["home_crest"], size), T.tile(fx[i-1]["away_crest"], size)
        ref.paste(lt,(lx,cy-size//2),lt); ref.paste(rt,(rx,cy-size//2),rt)
        T._vs(ref, b, T.W//2, cy)
    worst = max(ImageStat.Stat(ImageChops.difference(shot, ref)).mean)
    if worst >= 6:
        fails.append(f"{p.name}: frame at {t:.1f}s differs from data "
                     f"(mae {worst:.1f}) - {fx[i-1]['home_short']} "
                     f"{fx[i-1]['picks'][brand]['score']}")
    print(f"{'ok ' if worst < 6 else 'BAD'} {p.name:<44} {got:>5}f "
          f"{got/T.FPS:>6.1f}s audio={len(aud)} ocr={len(stops)}f "
          f"mae={worst:.2f}  {fx[i-1]['home_short']}-{fx[i-1]['away_short']} "
          f"{fx[i-1]['picks'][brand]['score']}"
          + (f"  forced-repeat: {','.join(forced)}" if forced else ""))


for brand in ("tippsarena", "luxtipps"):
    b = T.BRANDS[brand]
    for lid, league_slug in LEAGUES:
        d = json.loads((DATA / f"tips-{lid}.json").read_text(encoding="utf-8"))
        allfx = [f for f in d["fixtures"] if brand in f.get("picks", {})]
        # Every cut rendered for this league: the whole round, plus one per
        # kick-off night wherever tips_video --split produced a file. A day cut
        # is not a crop of the round video - it is its own encode with its own
        # match counter and its own last frame - so it is checked as its own
        # file rather than assumed to inherit the round video's result.
        cuts = [(league_slug, allfx)]
        for day in sorted({T.kickoff_day(f["kickoff"]) for f in allfx}):
            s = f"{league_slug}-{day:%d-%m}"
            if (T.OUT / f"{brand}-prognosen-{s}.mp4").exists():
                cuts.append((s, [f for f in allfx
                                 if T.kickoff_day(f["kickoff"]) == day]))
        for slug, fx in cuts:
            check(brand, b, d, fx, T.OUT / f"{brand}-prognosen-{slug}.mp4", slug)

print()
print("FAILURES:", len(fails))
for f in fails: print("  !!", f)
