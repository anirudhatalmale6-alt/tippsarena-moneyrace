"""Verify tippsarena.com/dach - the VIP-channel landing page.

Three things can break this page silently, and none of them show up as an
error anywhere:

1. NOTHING CLIPPED. The document-level overflow check is worthless here: .lp
   sets overflow-x: hidden, so a row that runs off the side of a card is quietly
   cut off and the page still reports zero horizontal overflow. The first build
   passed that way while "Mi., 02.09. 20:45 Uhr" and every percentage in every
   slip were sliced in half on a phone. So each element is measured against ITS
   OWN box and against the viewport, at four widths.

   The ticker is skipped by name. It is a marquee - twice the viewport wide on
   purpose - and that is the mechanism, not a defect. Named and excluded rather
   than absorbed into a bigger tolerance: a threshold large enough to swallow
   2832px would swallow every real clip too.

2. THE SLIPS ARE REAL AND CURRENT. They come from the site's own REST feed at
   request time. If WordPress changes shape, or the fetch times out, lib/tips.ts
   returns an empty list BY DESIGN and the section disappears - which is the
   right behaviour for a paid click and completely invisible from the outside.
   This asserts the slips are actually on the page, that their percentages are
   1-100, and that the fixtures shown match what the REST API says right now.

3. EXACTLY ONE Lead PER VISIT. The button leaves for t.me, so the pixel event
   fired on the tap is the only conversion signal Meta will ever get for this
   page. Zero events means the ad set is optimising blind; two events per person
   means his cost-per-lead reads better than it is, which is the direction of
   error nobody notices and nobody corrects. Four buttons are tapped here and
   exactly one Lead must come out.

    python3 verify_dach.py
    python3 verify_dach.py --selftest   # must report failures
"""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

URL = "https://tippsarena.com/dach"
REST = ("https://tippsarena.com/wp-json/wp/v2/posts"
        "?per_page=60&_fields=id,meta.ta_markets,meta.ta_matchinfo")
VIP_HOST = "t.me"
WIDTHS = [(390, 844, "iPhone"), (360, 780, "narrow Android"),
          (768, 1024, "tablet"), (1280, 720, "desktop")]
SELFTEST = "--selftest" in sys.argv

CLIP_JS = """() => {
  const bad = [];
  const vw = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll('.lp *')) {
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
    if (cs.position === 'fixed') continue;
    if (el.closest('.lp-ticker')) continue;      // a marquee, on purpose
    const over = el.scrollWidth - el.clientWidth;
    const past = Math.round(el.getBoundingClientRect().right - vw);
    if (over > 1 || past > 1) {
      bad.push({sel: String(el.className || el.tagName), over, past,
                text: (el.textContent || '').trim().slice(0, 46)});
    }
  }
  return bad;
}"""

SPY_JS = """() => {
  window.__calls = [];
  const orig = window.fbq;
  const spy = function(...a) { window.__calls.push(a); return orig.apply(this, a); };
  Object.assign(spy, orig);
  window.fbq = spy;
  // Bubble phase, so React's own onClick has already run: this only stops the
  // browser leaving the page, it does not stop the handler under test.
  window.__nav = 0;
  window.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="https://t.me"]');
    if (a) { e.preventDefault(); window.__nav++; }
  }, false);
}"""


def rest_fixtures():
    """What the site itself says is published, right now."""
    try:
        with urllib.request.urlopen(REST, timeout=15) as r:
            rows = json.load(r)
    except Exception as exc:                                   # noqa: BLE001
        print(f"        ! REST feed unreadable: {exc}")
        return None
    out = {}
    for row in rows:
        try:
            info = json.loads(row["meta"]["ta_matchinfo"])
            mk = json.loads(row["meta"]["ta_markets"])
        except Exception:                                      # noqa: BLE001
            continue
        combos = [c for c in (mk.get("betbuilder") or [])
                  if "Ergebnis-Prognose" not in c.get("title", "")
                  and len(c.get("picks") or []) >= 2]
        if not combos or not info.get("home"):
            continue
        out[f"{info['home']} vs {info['away']}"] = combos
    return out


fails = []

with sync_playwright() as pw:
    br = pw.chromium.launch()

    # --- 1. nothing clipped, at four widths ------------------------------
    for w, h, name in WIDTHS:
        ctx = br.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(1200)
        bad = page.evaluate(CLIP_JS)
        print(f"{'FAIL' if bad else 'PASS'}  nothing clipped at {name} {w}x{h} "
              f"({len(bad)} element(s))")
        for b in bad[:6]:
            print(f"        - {json.dumps(b, ensure_ascii=False)}")
            fails.append(f"{name}: clipped {b['sel']} ({b['text']})")
        ctx.close()

    # --- 2. the slips are on the page and match the site ------------------
    ctx = br.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.goto(URL, wait_until="networkidle", timeout=45000)
    page.wait_for_timeout(1200)

    slips = page.evaluate("""() => [...document.querySelectorAll('.vip-slip')].map(s => ({
        teams: [...s.querySelectorAll('.vip-team')].map(t => t.textContent.trim()),
        legs:  [...s.querySelectorAll('.vip-leg-row > span')].map(t => t.textContent.replace('✓','').trim()),
        pcts:  [...s.querySelectorAll('.vip-leg-row em')].map(t => parseInt(t.textContent, 10)),
        when:  (s.querySelector('.vip-when') || {}).textContent,
    }))""")
    if SELFTEST:
        slips = []                       # pretend the feed died
    print(f"{'FAIL' if not slips else 'PASS'}  {len(slips)} live slip(s) rendered")
    if not slips:
        fails.append("no slips on the page - the REST fetch in lib/tips.ts is "
                     "failing open and the section that proves the model exists "
                     "has silently vanished")

    site = rest_fixtures()
    for s in slips:
        who = " vs ".join(s["teams"])
        if len(s["legs"]) < 2:
            fails.append(f"{who}: only {len(s['legs'])} leg(s) - a bet builder is not one bet")
        bad_pct = [p for p in s["pcts"] if not (1 <= p <= 100)]
        if bad_pct:
            fails.append(f"{who}: percentage out of range {bad_pct}")
        if len(s["pcts"]) != len(s["legs"]):
            fails.append(f"{who}: {len(s['legs'])} legs but {len(s['pcts'])} percentages")
        if site is not None:
            combos = site.get(who)
            if combos is None:
                fails.append(f"{who}: on the landing page but NOT in the site's "
                             f"own feed - the page is showing a fixture the site "
                             f"is not publishing")
            else:
                want = {p["label"] for c in combos for p in c["picks"]}
                stray = [l for l in s["legs"] if l not in want]
                if stray:
                    fails.append(f"{who}: legs not published by the site: {stray}")
        print(f"        {who} — {s['when']} — "
              f"{', '.join(f'{l} {p}%' for l, p in zip(s['legs'], s['pcts']))}")

    # --- 3. exactly one Lead, however many times it is tapped -------------
    page.evaluate(SPY_JS)
    buttons = page.query_selector_all('a.lp-cta[href^="https://t.me"]')
    print(f"        {len(buttons)} button(s), all pointing at {VIP_HOST}")
    if len(buttons) < 2:
        fails.append(f"only {len(buttons)} Telegram button(s) on a page whose "
                     f"whole job is that one tap")
    for b in buttons:
        try:
            b.click(timeout=2500)
        except Exception:                                      # noqa: BLE001
            pass
    page.wait_for_timeout(800)
    calls = page.evaluate("() => window.__calls") or []
    taps = page.evaluate("() => window.__nav") or 0
    leads = [c for c in calls if len(c) > 1 and c[1] == "Lead"]
    want_leads = 2 if SELFTEST else 1
    ok = len(leads) == want_leads and taps >= 2
    print(f"{'PASS' if ok else 'FAIL'}  {len(leads)} Lead event(s) from {taps} taps "
          f"(want exactly {want_leads})")
    if not ok:
        fails.append(f"{len(leads)} Lead events from {taps} taps: Meta is being "
                     f"told the wrong number of conversions")

    # Every button must leave for Telegram and nowhere else. One action.
    hrefs = page.evaluate(
        """() => [...document.querySelectorAll('.lp a[href]')]
             .map(a => a.getAttribute('href'))
             .filter(h => h && !h.startsWith('#'))""")
    off = [h for h in hrefs if not h.startswith("https://t.me/")
           and "check-dein-spiel" not in h]
    print(f"{'FAIL' if off else 'PASS'}  no second destination competing for the tap")
    for h in off:
        print(f"        - {h}")
        fails.append(f"a link out of the funnel: {h}")

    ctx.close()
    br.close()

print(f"\n{len(fails)} failures")
for f in fails:
    print(f"  - {f}")
if SELFTEST:
    print("selftest: expected failures above (no slips, wrong Lead count)")
    sys.exit(0 if len(fails) >= 2 else 1)
sys.exit(1 if fails else 0)
