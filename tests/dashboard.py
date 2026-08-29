"""Drive the real dashboard in a browser: log in, walk every page, screenshot.

    ADMIN_URL=http://127.0.0.1:3200 python3 tests/dashboard.py out/ "das-passwort"


Checks what a browser actually rendered, not what the code says it should.
"""
import os, sys, pathlib
from playwright.sync_api import sync_playwright

BASE = os.environ.get("ADMIN_URL", "http://127.0.0.1:3200")
OUT = pathlib.Path(sys.argv[1])
PW = sys.argv[2]
OUT.mkdir(parents=True, exist_ok=True)

PAGES = [
    ("/", "dashboard"),
    ("/competitions", "wettbewerbe"),
    ("/competitions/new", "neu"),
    ("/competitions/8", "detail"),
    ("/matches", "spiele"),
    ("/participants", "teilnehmer"),
    ("/leaderboards", "leaderboards"),
    ("/winners", "gewinner"),
    ("/referrals", "referrals"),
    ("/analytics", "analytics"),
    ("/telegram", "telegram"),
    ("/settings", "einstellungen"),
]

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
    page.wait_for_load_state("load"); page.wait_for_timeout(1200)
    check("a wrong password is refused",
          "fehler" in page.url or "falsch" in page.content())

    # --- real login
    page.goto(f"{BASE}/login", wait_until="load")
    page.fill("#email", "trifun@tippsarena.com")
    page.fill("#password", PW)
    page.click("button[type=submit]")
    page.wait_for_load_state("load"); page.wait_for_timeout(1200)
    check("the right password gets in", page.url.rstrip("/") == BASE, page.url)

    body = page.content()
    check("the dashboard is in German", "Aktive Wettbewerbe" in body)
    check("...and shows the live competition", "Bundesliga MoneyRace #1" in body)

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
                check(f"{path} has no English leak ({leak})", False)
        check(f"{path} is not blank", len(visible.strip()) > 80, f"{len(visible)} chars")
        page.screenshot(path=str(OUT / f"desk_{name}.png"))

    # --- the "Tuesday morning" flow: template -> form is pre-filled
    page.goto(f"{BASE}/competitions/new", wait_until="load")
    page.click("text=🏁 Bundesliga MoneyRace")
    page.wait_for_load_state("load"); page.wait_for_timeout(1200)
    prize = page.input_value("#prize_amount")
    check("picking a template pre-fills the prize", prize == "250", prize)
    ticked = page.eval_on_selector_all(
        "input[name=fixture]", "els => els.filter(e => e.checked).length")
    check("...and pre-ticks the matches", ticked == 10 or ticked > 0, str(ticked))
    page.screenshot(path=str(OUT / "desk_neu_vorlage.png"))

    # --- settings round trip: does a saved value come back?
    page.goto(f"{BASE}/settings", wait_until="load")
    page.fill("#brand_name", "TippsArena")
    page.select_option("#timezone", "Europe/Berlin")
    page.get_by_role("button", name="SPEICHERN", exact=True).click()
    page.wait_for_load_state("load"); page.wait_for_timeout(1200)
    check("settings save and come back", "gespeichert" in page.url)
    check("...with the value still in the box",
          page.input_value("#brand_name") == "TippsArena")

    # --- phone
    phone = browser.new_context(viewport={"width": 390, "height": 780},
                                is_mobile=True, has_touch=True)
    pp = phone.new_page()
    pp.goto(f"{BASE}/login", wait_until="load")
    pp.fill("#email", "trifun@tippsarena.com")
    pp.fill("#password", PW)
    pp.click("button[type=submit]")
    pp.wait_for_load_state("load"); pp.wait_for_timeout(1200)
    for path, name in [("/", "dashboard"), ("/competitions", "wettbewerbe"),
                       ("/competitions/new", "neu"), ("/competitions/8", "detail")]:
        pp.goto(f"{BASE}{path}", wait_until="load")
        pp.screenshot(path=str(OUT / f"phone_{name}.png"))
        # §40: he must be able to work on a phone - no sideways scrolling.
        overflow = pp.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{path} does not scroll sideways on a phone", overflow <= 1, f"{overflow}px")

    check("no javascript errors anywhere", not errors, "; ".join(errors[:3]))
    browser.close()

print(f"\n{'FAILURES: ' + ', '.join(fails) if fails else 'ALL PASSED'}  ({len(fails)} failed)")
sys.exit(1 if fails else 0)
