"""Verify Meta pixel 1595359095532832 on tippsarena.com.

What this can and cannot prove
------------------------------
It CANNOT watch the /tr beacon. Measured: the client's snippet verbatim, alone
on a blank page at this same origin, also emits zero /tr from this headless
browser while reporting eventCount 1 - so an absent beacon here says nothing
about the install. Asserting on it failed all five pages for a reason that had
nothing to do with them.

What it does prove, per page, in a real browser:
  * fbevents.js loaded from Meta, and
  * Meta returned the per-pixel config for THIS id on THIS domain (so it is an
    id Meta recognises here - a typo'd id gets no config), and
  * fbq is initialised with exactly the id he sent and no other, and
  * eventCount > 0: the library accepted a PageView rather than merely existing.

Plus the two things a static read of the HTML cannot see at all:
  * the admin dashboard, served by the same Next process, must have NO pixel;
  * every internal link in the public group must still cause a DOCUMENT load.
    One PageView per document is only enough because these are plain anchors.
    The day one becomes a next/link, the page it opens renders without a new
    document and Meta never hears about it - a silent undercount with no error
    anywhere. This asserts that assumption instead of trusting it.

    python3 verify_pixel.py
    python3 verify_pixel.py --selftest   # must report failures
"""
import sys
import json
from playwright.sync_api import sync_playwright

PIXEL = "1595359095532832"
PUBLIC = ["https://tippsarena.com/",
          "https://tippsarena.com/gratiswetten/",
          "https://tippsarena.com/moneyrace",
          "https://tippsarena.com/dach",
          "https://tippsarena.com/leaderboard"]
ADMIN = ["https://admin.tippsarena.com/login"]
SELFTEST = "--selftest" in sys.argv
WANT = "9999999999999999" if SELFTEST else PIXEL


def state(page):
    return page.evaluate("""() => {
      if (typeof window.fbq !== 'function') return {fbq: false};
      const s = window.fbq.getState ? window.fbq.getState() : null;
      if (!s) return {fbq: true, lib: false};
      return {fbq: true, lib: true,
              ids: s.pixels.map(p => p.id),
              events: s.pixels.reduce((n, p) => n + (p.eventCount || 0), 0)};
    }""")


def open_page(ctx, url):
    seen = []
    page = ctx.new_page()
    page.on("response", lambda r: seen.append((r.url, r.status)))
    page.goto(url, wait_until="networkidle", timeout=45000)
    page.wait_for_timeout(2500)
    return page, seen


fails = []
with sync_playwright() as pw:
    br = pw.chromium.launch()

    for url in PUBLIC:
        ctx = br.new_context(viewport={"width": 1280, "height": 720})
        page, seen = open_page(ctx, url)
        st = state(page)
        cfg = [s for u, s in seen if f"signals/config/{WANT}" in u]
        why = []
        if not st.get("fbq"):
            why.append("fbq never defined")
        elif not st.get("lib"):
            why.append("only the stub - fbevents.js did not load")
        else:
            if st["ids"] != [WANT]:
                why.append(f"pixel ids are {st['ids']}, expected [{WANT}]")
            if not st.get("events"):
                why.append("fbq loaded but accepted no PageView")
        if not cfg:
            why.append(f"Meta served no config for {WANT} on this domain")
        elif cfg[0] != 200:
            why.append(f"config HTTP {cfg[0]}")
        print(f"{'FAIL' if why else 'PASS'}  {url}")
        print(f"        {json.dumps(st)}  config={cfg}")
        for w in why:
            print(f"        - {w}")
            fails.append(f"{url}: {w}")
        ctx.close()

    # One PageView per document is correct ONLY while these links are plain
    # anchors. Prove it: a real click must throw the window object away.
    ctx = br.new_context(viewport={"width": 1280, "height": 720})
    page, _ = open_page(ctx, "https://tippsarena.com/moneyrace")
    docs = []
    page.on("request", lambda r: docs.append(r.url)
            if r.resource_type == "document" else None)
    page.evaluate("() => { window.__marker = 1; }")
    page.click('a[href="/leaderboard"]')
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    survived = page.evaluate("() => window.__marker || null")
    ok = survived is None and len(docs) >= 1
    print(f"{'PASS' if ok else 'FAIL'}  /moneyrace -> /leaderboard is a document "
          f"load (docs={len(docs)}, window discarded={survived is None})")
    if not ok:
        fails.append("public links no longer reload the document - the pixel "
                     "now undercounts every page after the first; add a "
                     "usePathname PageView effect to pixel.tsx")
    ctx.close()

    for url in ADMIN:
        ctx = br.new_context(viewport={"width": 1280, "height": 720})
        page, seen = open_page(ctx, url)
        st = state(page)
        bad = bool(st.get("fbq")) or any("facebook" in u for u, _ in seen)
        print(f"{'FAIL' if bad else 'PASS'}  (must NOT fire) {url}  {json.dumps(st)}")
        if bad:
            fails.append(f"{url}: the dashboard is being tracked")
        ctx.close()

    br.close()

print(f"\n{len(fails)} failures")
if SELFTEST:
    print("selftest: expected a failure on every public page above")
    sys.exit(0 if len(fails) >= len(PUBLIC) else 1)
sys.exit(1 if fails else 0)
