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
    # A heading on the Telegram page that survived the first translation pass
    # because no word on this list happened to be a substring of it.
    "Gesendet",
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
  // .lp-content holds message bodies the operator SENT to players. They are
  // German by design and are content, not chrome - reading them would make
  // this check fail every time he broadcasts anything.
  copy.querySelectorAll('textarea, input, select, option, script, style, .lp-content')
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

    # --- wrong password. Submitted twice for the same cold-start reason as the
    # real login below: the first POST after a restart can outrun the server.
    def wrong():
        page.goto(f"{BASE}/login", wait_until="load")
        page.fill("#email", "trifun@tippsarena.com")
        page.fill("#password", "definitely-not-it")
        page.click("button[type=submit]")
        settle(page)
        return "error" in page.url or "is wrong" in page.inner_text("body")

    refused = False
    for attempt in range(3):
        refused = wrong()
        if refused:
            break
        page.wait_for_timeout(4000)
    check("a wrong password is refused", refused, page.url)

    # --- real login
    # Two attempts, because the GET warm-up above does not warm the server-action
    # POST path: the very first form submission after a restart can be slower
    # than the click that triggered it. A login that is genuinely broken still
    # fails the second time, so nothing is masked.
    def login():
        page.goto(f"{BASE}/login", wait_until="load")
        page.fill("#email", "trifun@tippsarena.com")
        page.fill("#password", PW)
        page.click("button[type=submit]")
        settle(page)
        return page.url.rstrip("/") == BASE

    for attempt in range(3):
        if login():
            break
        page.wait_for_timeout(4000)
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

    # --- "why is my competition not in the bot?"
    # He created three competitions, every one of them said "draft", and nothing
    # on any screen connected that word to "players cannot see it". These check
    # the answer is now written down in three places. Read-only throughout:
    # nothing here presses PUBLISH or SEND on his real data.
    page.goto(f"{BASE}/", wait_until="load")
    home = page.inner_text("body")
    check("the dashboard warns about competitions that are not live",
          "not visible in the bot" in home.lower(), home[:200])
    check("...and says a draft is not enough",
          "press publish" in home.lower())

    page.goto(f"{BASE}/competitions", wait_until="load")
    listing = page.inner_text("body")
    # Table headings are uppercased in CSS and inner_text applies that, so the
    # comparison has to be case-insensitive or a correct page fails.
    check("the competition list answers 'is it in the bot?'",
          "in the bot?" in listing.lower())
    check("...and spells out that a draft is not",
          "not visible" in listing.lower())
    # Only assert this when something IS live. His competitions move - a lock
    # time passes and a correct page fails a test that named a state rather
    # than a rule. Which branch ran is printed, so "nothing was checked" can
    # never masquerade as a pass.
    open_rows = page.eval_on_selector_all(
        "tbody tr td .badge", "els => els.map(e => e.textContent.trim())")
    if any(b.lower() == "open" for b in open_rows):
        check("...and marks the open one as live",
              "live in the bot" in listing.lower())
    else:
        check("...and marks nothing as live when nothing is open",
              "live in the bot" not in listing.lower(), str(open_rows))
    # The column has to stay one line per row: the full sentence wrapped it into
    # six lines and made the table unreadable, which no status-code or
    # text-presence check would ever have noticed.
    tall = page.eval_on_selector_all(
        "tbody tr", "els => els.map(e => e.getBoundingClientRect().height)")
    check("...without making every row enormous", max(tall) < 120, f"{max(tall)}px")

    # #59 is his own draft with no lock time and no matches. Its page has to say
    # both of those before the click, not throw an error after it.
    page.goto(f"{BASE}/competitions/59", wait_until="load")
    detail = page.inner_text("body")
    check("a draft that cannot publish says why (lock time)",
          "lock time" in detail.lower())
    check("...and why (matches)", "no matches" in detail.lower())
    disabled = page.eval_on_selector_all(
        "button", "els => els.filter(e => /PUBLISH/i.test(e.textContent)).map(e => e.disabled)")
    check("...and its PUBLISH button is not clickable", disabled == [True], str(disabled))
    # A disabled button that still looks pressable is worse than no button: he
    # clicks it, nothing happens, and the dashboard looks broken.
    faded = page.eval_on_selector_all(
        "button:disabled",
        "els => els.map(e => getComputedStyle(e).backgroundColor)")
    check("...and it does not look pressable",
          faded and all(c != "rgb(46, 160, 67)" for c in faded), str(faded))
    page.screenshot(path=str(OUT / "desk_blocked.png"))

    # Rather than naming a competition - his data moves, and a lock time that
    # passes turns a correct page into a failing check - walk what is actually
    # there and assert the RULES that must hold for every one of them.
    page.goto(f"{BASE}/competitions", wait_until="load")
    ids = page.eval_on_selector_all(
        "tbody tr td a[href^='/competitions/']",
        "els => els.map(e => e.getAttribute('href'))")
    check("there are competitions to walk", len(ids) > 0, str(ids))

    checked_blocked = checked_ready = checked_live = checked_draft = 0
    for href in ids[:8]:
        page.goto(f"{BASE}{href}", wait_until="load")
        body = page.inner_text("body")
        publish = page.eval_on_selector_all(
            "button",
            "els => els.filter(e => /PUBLISH/i.test(e.textContent)).map(e => e.disabled)")
        blocked = "It cannot go live yet" in body

        if publish:
            if blocked:
                check(f"{href}: a blocked draft cannot be published", publish == [True],
                      str(publish))
                checked_blocked += 1
            else:
                check(f"{href}: a ready draft can be published", publish == [False],
                      str(publish))
                checked_ready += 1

        # ANNOUNCE belongs to live competitions and nowhere else - an advert for
        # something nobody can enter points at a locked door.
        live = "Live in the bot" in body
        has_announce = "ANNOUNCE" in body
        check(f"{href}: announce is offered only when it is live", live == has_announce,
              f"live={live} announce={has_announce}")
        if live:
            checked_live += 1
            audiences = page.eval_on_selector_all(
                "#audience option", "els => els.map(e => e.value)")
            check(f"{href}: announce reaches channel, users or both",
                  sorted(audiences) == ["both", "channel", "users"], str(audiences))
        if publish:
            checked_draft += 1

    # A loop that examined nothing passes every assertion inside it.
    check("...and at least one draft was examined", checked_draft > 0,
          f"blocked={checked_blocked} ready={checked_ready} live={checked_live}")
    page.screenshot(path=str(OUT / "desk_ready.png"))

    # --- deleting a competition. Read-only: the first press only ASKS, and this
    # never presses the second button - #59 is his own draft.
    page.goto(f"{BASE}/competitions/59", wait_until="load")
    check("a competition can be deleted", "DELETE" in page.inner_text("body"))
    page.get_by_role("button", name="🗑 DELETE").click()
    settle(page)
    warn = page.inner_text("body")
    check("...but the first press only asks", "confirm_delete" in page.url, page.url)
    check("...naming the competition", "Delete" in warn and "for good" in warn)
    check("...and what would go with it", "participant(s)" in warn)
    check("...and that it cannot be undone", "cannot be undone" in warn.lower())
    still = page.goto(f"{BASE}/competitions/59", wait_until="load")
    check("...and nothing was deleted", still.status == 200, str(still.status))
    page.screenshot(path=str(OUT / "desk_delete.png"))

    # --- broadcasting
    page.goto(f"{BASE}/telegram", wait_until="load")
    tg = page.inner_text("body")
    check("the Telegram page has a broadcast form", "Broadcast" in tg)
    audiences = page.eval_on_selector_all(
        "#audience option", "els => els.map(e => e.value)")
    check("...with all three audiences",
          sorted(audiences) == ["both", "channel", "users"], str(audiences))
    check("...and a box to write the message himself",
          page.locator("#broadcast_body").count() == 1)
    # Two elements sharing an id makes a <label for> point at whichever the
    # browser finds first, so the count is one on purpose.
    check("...and the template editor still has its own box",
          page.locator("#body").count() == 1)
    # The table only has headings once something has been broadcast; before that
    # the panel says so. Either is correct - a panel that is missing entirely is
    # not, and that is what this catches.
    # Sorted by name the first channel template is "competition closed"; a SEND
    # button pre-loaded with that is one stray click from telling everyone a
    # running competition is over.
    check("...and does not default to announcing a competition is over",
          page.input_value("#key") == "channel_competition_new",
          page.input_value("#key"))
    check("...and a place where past broadcasts are listed",
          "delivered" in tg.lower() or "nothing broadcast yet" in tg.lower())
    page.screenshot(path=str(OUT / "desk_broadcast.png"))

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

    # ---------------------------------------------------- the ad pages
    # /moneyrace and /dach are paid traffic. What has to be true of both: the
    # sticky bar is hidden at the top and shows after scrolling, the legal
    # block Meta requires is present and readable, and the two pages do NOT say
    # the same thing - he asked for a second angle, not a second copy.
    heros = {}
    for path in ("/moneyrace", "/dach"):
        pp.goto(f"{SITE}{path}", wait_until="load")
        pp.wait_for_timeout(700)

        hidden = pp.eval_on_selector_all(
            ".lp-stick", "els => els.map(e => getComputedStyle(e).display)")
        check(f"{path} does not double up its button at the top",
              hidden == ["none"], str(hidden))
        pp.mouse.wheel(0, 900)
        pp.wait_for_timeout(500)
        shown = pp.eval_on_selector_all(
            ".lp-stick", "els => els.map(e => getComputedStyle(e).display)")
        check(f"{path} brings the button back once you scroll",
              shown == ["block"], str(shown))

        # His brand, not the reference site's. The lime was borrowed; the orange
        # is sampled from his own logo file.
        accent = pp.eval_on_selector(
            ".lp-ticker", "e => getComputedStyle(e).backgroundColor")
        check(f"{path} uses his orange, not the borrowed lime",
              accent == "rgb(255, 110, 3)", accent)
        marks = pp.eval_on_selector_all(
            "img.lp-mark", "els => els.map(e => e.naturalWidth)")
        # naturalWidth is 0 for a broken image, and a broken logo still passes
        # any check that only looks for the <img> tag.
        check(f"{path} actually paints his logo",
              len(marks) >= 2 and all(w > 0 for w in marks), str(marks))

        text = pp.inner_text("body")
        check(f"{path} states its independence from Meta",
              "Meta Platforms" in text)
        check(f"{path} says no stake is taken", "kein einsatz" in text.lower())
        check(f"{path} states the age limit", "18" in text)
        # An invented statistic on his brand is his problem long after it is my
        # line of code. Nothing on these pages may claim a rate nobody measured.
        for invented in ("win rate", "gewinnquote", "% erfolg"):
            check(f"{path} claims no unmeasured {invented}",
                  invented not in text.lower())

        # The PRIMARY buttons all have to be the same one action. The ghost
        # button to the channel is deliberately a second, quieter offer, so it
        # is excluded rather than allowed to break the rule.
        primary = pp.eval_on_selector_all(
            "a.lp-cta:not(.lp-ghost)", "els => els.map(e => e.href)")
        check(f"{path} sends every primary button to the same place",
              len(set(primary)) == 1, str(sorted(set(primary))))
        campaign = "fb_moneyrace" if path == "/moneyrace" else "fb_dach"
        check(f"{path} carries its own campaign code",
              all(campaign in c for c in primary), str(primary))
        check(f"{path} has more than one chance to press it", len(primary) >= 3,
              str(len(primary)))
        heros[path] = pp.inner_text("h1")

    check("the two ad pages do not share a headline",
          heros["/moneyrace"] != heros["/dach"],
          f'{heros["/moneyrace"]!r} vs {heros["/dach"]!r}')

    check("no javascript errors anywhere", not errors, "; ".join(errors[:3]))
    browser.close()

print(f"\n{'FAILURES: ' + ', '.join(fails) if fails else 'ALL PASSED'}  ({len(fails)} failed)")
sys.exit(1 if fails else 0)
