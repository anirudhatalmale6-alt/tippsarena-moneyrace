"""Drive the real dashboard and the public pages in a browser.

    ADMIN_URL=http://127.0.0.1:3200 python3 tests/dashboard.py out/ "the-password"

Checks what a browser actually rendered, not what the code says it should.

Two languages live in this application on purpose: the dashboard is English
(only the operator reads it) and everything a player sees is German. So the
language checks run in both directions - English expected on every admin page,
German expected on every public page. A one-directional check would pass just
as happily if the pages were blank.
"""
import os, sys, pathlib
from playwright.sync_api import sync_playwright

BASE = os.environ.get("ADMIN_URL", "http://127.0.0.1:3200")
SITE = os.environ.get("SITE_URL", "https://tippsarena.com")
OUT = pathlib.Path(sys.argv[1])
PW = sys.argv[2]
OUT.mkdir(parents=True, exist_ok=True)

PAGES = [
    ("/", "dashboard"),
    ("/competitions", "competitions"),
    ("/competitions/new", "new"),
    ("/competitions/8", "detail"),
    ("/matches", "matches"),
    ("/participants", "participants"),
    ("/leaderboards", "leaderboards"),
    ("/winners", "winners"),
    ("/referrals", "referrals"),
    ("/analytics", "analytics"),
    ("/telegram", "telegram"),
    ("/settings", "settings"),
]

# Words that WERE on these pages before 29 Aug. If any of them is still visible,
# a string was missed. The same list is used against the public pages further
# down, where it MUST fire - that is what proves the check is not vacuous.
GERMAN = [
    "Wettbewerb", "Teilnehmer", "Gewinner", "Einstellungen", "Preisgeld",
    "Tippschluss", "Gespeichert", "Nutzer", "Spiele", "Punkte", "Werber",
    "Vorlage", "Anstoß", "Währung", "Zeitzone", "Einladung", "Ergebnis",
    "Auswertung", "Entwurf", "Geöffnet", "Gesperrt", "Beendet", "Abmelden",
    "Speichern", "Löschen", "Fehler", "Suche", "Wann", "Noch keine",
    # German weekday abbreviations: dates were formatted de-DE before.
    "Sa.,", "So.,", "Mo.,", "Di.,", "Mi.,", "Do.,", "Fr.,",
]

PUBLIC = [("/moneyrace", "lp_moneyrace"), ("/dach", "lp_dach"),
          ("/leaderboard", "lp_leaderboard")]

fails = []


def settle(pg):
    """Wait for the page to be usable, not merely loaded.

    networkidle is not it: it can come back while React is mid-hydration, and a
    click then lands on a button React owns but has not wired up yet - the
    native form submit is swallowed and nothing at all is posted.
    """
    pg.wait_for_load_state("load")
    pg.wait_for_timeout(900)


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"   {detail}" if detail and not ok else ""))
    if not ok:
        fails.append(name)


def german_in(text):
    return [word for word in GERMAN if word in text]


# The dashboard's own words are English, but it EDITS German - the Telegram page
# and the rules box hold the message templates a player reads. Those must not be
# translated and must not fail the check, so form fields are taken out first.
# Scripts go too: Next puts its 404 boundary in the streamed payload of every
# page, and textContent would otherwise pick it up.
CHROME_ONLY = """() => {
  const copy = document.body.cloneNode(true);
  copy.querySelectorAll('textarea, input, select, option, script, style')
      .forEach(el => el.remove());
  return copy.textContent;
}"""


# A run started immediately after a restart once "proved" the login was broken:
# the first request to a cold Next server is slow enough that the click landed
# before the page could handle it. Warm it up first, so a failure below is
# always about the application and never about the clock.
import urllib.request
for attempt in range(20):
    try:
        with urllib.request.urlopen(f"{BASE}/login", timeout=10) as response:
            if response.status == 200:
                break
    except Exception:
        pass
    import time; time.sleep(2)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # --- the guard
    page.goto(f"{BASE}/", wait_until="load")
    check("an anonymous visitor is sent to the login page", "/login" in page.url, page.url)

    # --- wrong password
    page.fill("#email", "trifun@tippsarena.com")
    page.fill("#password", "definitely-not-it")
    page.click("button[type=submit]")
    settle(page)
    check("a wrong password is refused",
          "error" in page.url or "is wrong" in page.inner_text("body"))

    # --- real login
    page.goto(f"{BASE}/login", wait_until="load")
    page.fill("#email", "trifun@tippsarena.com")
    page.fill("#password", PW)
    page.click("button[type=submit]")
    settle(page)
    check("the right password gets in", page.url.rstrip("/") == BASE, page.url)

    visible = page.inner_text("body")
    # inner_text applies text-transform, and the card labels are uppercased in
    # CSS - comparing case-sensitively would fail on a page that is correct.
    check("the dashboard is in English", "active competitions" in visible.lower())
    check("...and shows the live competition", "Bundesliga MoneyRace #1" in visible)

    # --- the navigation, which is what he actually asked to be translated
    nav = page.inner_text(".nav")
    for label in ["Dashboard", "Competitions", "Matches", "Participants",
                  "Leaderboards", "Winners", "Referrals", "Analytics",
                  "Telegram", "Settings"]:
        check(f"menu says {label}", label in nav)
    check("no German left in the menu", not german_in(nav), ", ".join(german_in(nav)))

    for path, name in PAGES:
        page.goto(f"{BASE}{path}", wait_until="load")
        content = page.content()
        visible = page.inner_text("body")
        ok = page.url.endswith(path) or path == "/"
        check(f"{path} renders", ok and "Application error" not in content
              and "Internal Server Error" not in content, page.url)
        # Visible text only: Next puts its 404 boundary in the streamed payload
        # of every page, so page.content() would fail this for the wrong reason.
        for leak in ("Loading...", "This page could not be found",
                     "Application error"):
            if leak in visible:
                check(f"{path} has no framework leak ({leak})", False)
        left = german_in(page.evaluate(CHROME_ONLY))
        check(f"{path} has no German left", not left, ", ".join(left))
        check(f"{path} is not blank", len(visible.strip()) > 80, f"{len(visible)} chars")
        page.screenshot(path=str(OUT / f"desk_{name}.png"))

    # --- the "Tuesday morning" flow: template -> form is pre-filled
    page.goto(f"{BASE}/competitions/new", wait_until="load")
    page.click("text=🏁 Bundesliga MoneyRace")
    settle(page)
    prize = page.input_value("#prize_amount")
    check("picking a template pre-fills the prize", prize == "250", prize)
    ticked = page.eval_on_selector_all(
        "input[name=fixture]", "els => els.filter(e => e.checked).length")
    check("...and pre-ticks the matches", ticked > 0, str(ticked))
    page.screenshot(path=str(OUT / "desk_new_template.png"))

    # --- settings round trip: does a saved value come back?
    page.goto(f"{BASE}/settings", wait_until="load")
    page.fill("#brand_name", "TippsArena")
    page.select_option("#timezone", "Europe/Berlin")
    page.get_by_role("button", name="SAVE", exact=True).click()
    settle(page)
    check("settings save and come back", "saved" in page.url, page.url)
    check("...with the value still in the box",
          page.input_value("#brand_name") == "TippsArena")

    # --- the old German routes must not still be serving a second copy
    for dead in ["/wettbewerbe", "/spiele", "/teilnehmer", "/gewinner",
                 "/einstellungen"]:
        response = page.goto(f"{BASE}{dead}", wait_until="load")
        check(f"{dead} is gone", response.status == 404, str(response.status))
    # Those five 404s are the point of the check above, and the browser logs
    # each one as a console error. Dropping them here keeps the "no javascript
    # errors" check at the end about real errors instead of about this test.
    errors.clear()

    # --- phone
    phone = browser.new_context(viewport={"width": 390, "height": 780},
                                is_mobile=True, has_touch=True)
    pp = phone.new_page()
    pp.goto(f"{BASE}/login", wait_until="load")
    pp.fill("#email", "trifun@tippsarena.com")
    pp.fill("#password", PW)
    pp.click("button[type=submit]")
    settle(pp)
    for path, name in [("/", "dashboard"), ("/competitions", "competitions"),
                       ("/competitions/new", "new"), ("/competitions/8", "detail")]:
        pp.goto(f"{BASE}{path}", wait_until="load")
        pp.screenshot(path=str(OUT / f"phone_{name}.png"))
        # §40: he must be able to work on a phone - no sideways scrolling.
        overflow = pp.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{path} does not scroll sideways on a phone", overflow <= 1, f"{overflow}px")

    # ------------------------------------------------------------------ public
    # Fetched over the real hostname, through nginx, so this also tests that
    # WordPress is not the thing answering and that the stylesheet arrives.
    pub = ctx.new_page()
    for path, name in PUBLIC:
        response = pub.goto(f"{SITE}{path}", wait_until="load")
        pub.wait_for_timeout(600)
        visible = pub.inner_text("body")
        check(f"{path} is served", response.status == 200, str(response.status))
        check(f"{path} is the Next page, not WordPress",
              "TIPPSARENA" in visible and "WordPress" not in pub.content())
        # The control for the German-leak check above: it MUST fire here.
        check(f"{path} is in German", bool(german_in(visible)),
              "no German found - the detector is broken")
        # A page whose CSS did not arrive still has text; measure the paint.
        bg = pub.evaluate(
            "() => getComputedStyle(document.querySelector('.lp')).backgroundColor")
        check(f"{path} got its stylesheet", bg == "rgb(7, 11, 16)", bg)
        pub.screenshot(path=str(OUT / f"{name}.png"))

    # The masked names are the whole point of the public leaderboard.
    pub.goto(f"{SITE}/leaderboard", wait_until="load")
    pub.wait_for_timeout(400)
    board = pub.inner_text("body")
    check("the public leaderboard shows masked names", "******" in board)
    for secret in ["thomastippsarena", "roktok52", "8826048055", "1486151372"]:
        check(f"...and never the real {secret}", secret not in pub.content())

    # Phone, because the ads run on phones.
    for path, name in PUBLIC:
        pp.goto(f"{SITE}{path}", wait_until="load")
        pp.wait_for_timeout(400)
        pp.screenshot(path=str(OUT / f"phone_{name}.png"))
        overflow = pp.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{path} does not scroll sideways on a phone", overflow <= 1, f"{overflow}px")
        # A landing page with no reachable call to action is a broken ad.
        ctas = pp.eval_on_selector_all(
            "a.lp-cta", "els => els.map(e => e.getAttribute('href'))")
        check(f"{path} has a call to action", len(ctas) > 0, str(ctas))
        check(f"{path} call to action points somewhere real",
              all(h and (h.startswith("https://t.me/") or h.startswith("/")) for h in ctas),
              str(ctas))

    check("no javascript errors anywhere", not errors, "; ".join(errors[:3]))
    browser.close()

print(f"\n{'FAILURES: ' + ', '.join(fails) if fails else 'ALL PASSED'}  ({len(fails)} failed)")
sys.exit(1 if fails else 0)
