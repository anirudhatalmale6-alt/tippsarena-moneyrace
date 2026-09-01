#!/usr/bin/env python3
"""The live campaign, read from his database - never typed into a creative.

The 29 August ads carry `PRIZE = "149,97 €"` and a Tippschluss of 15:25 as
string literals. Both were true when they were written and neither is true of
competition 442, so uploading those files this weekend would have promised a
prize the bot does not pay. Every figure a creative prints comes from here.

`data/campaign.json` is refreshed by `fetch_campaign.sh`; the creatives only
ever read the file, so a render is reproducible and does not need the server.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import zoneinfo

ROOT = pathlib.Path(__file__).resolve().parent
BERLIN = zoneinfo.ZoneInfo("Europe/Berlin")

_DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag",
         "Samstag", "Sonntag"]
_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
           "August", "September", "Oktober", "November", "Dezember"]

# Long club names do not fit a bar on a phone. Shortened the way a German
# football fan writes them, never invented.
SHORT = {
    "Borussia Mönchengladbach": "Gladbach",
    "Borussia Dortmund": "Dortmund",
    "Bayer Leverkusen": "Leverkusen",
    "1899 Hoffenheim": "Hoffenheim",
    "SC Paderborn 07": "Paderborn",
    "SV Elversberg": "Elversberg",
    "Werder Bremen": "Bremen",
    "RB Leipzig": "Leipzig",
    "SC Freiburg": "Freiburg",
    "Union Berlin": "Union Berlin",
    "Eintracht Frankfurt": "Frankfurt",
    "Bayern München": "Bayern",
    "VfB Stuttgart": "Stuttgart",
    "VfL Wolfsburg": "Wolfsburg",
    "FSV Mainz 05": "Mainz 05",
    "1. FC Köln": "Köln",
    "FC Augsburg": "Augsburg",
    "FC St. Pauli": "St. Pauli",
    "Hamburger SV": "HSV",
    "1. FC Heidenheim": "Heidenheim",
}


def money(value: float, currency: str = "EUR") -> str:
    """German money. 100.00 -> '100 €' - a round amount does not carry ',00'
    on a poster, and 149.97 must never be rounded UP to 150."""
    symbol = "€" if currency == "EUR" else currency
    if abs(value - round(value)) < 0.005:
        return f"{int(round(value))} {symbol}"
    return f"{value:.2f}".replace(".", ",") + f" {symbol}"


class Campaign:
    def __init__(self, data: dict):
        self.raw = data
        self.id = data["id"]
        self.name = data["name"]
        self.prize = float(data["prize"])
        self.currency = data.get("currency", "EUR")
        self.winner_count = int(data.get("winner_count", 1))
        self.requires_membership = bool(data.get("requires_membership"))
        self.locks_at = dt.datetime.fromisoformat(data["locks_at"])
        self.scoring = data.get("scoring") or {}
        self.bot = data.get("bot_username") or "TippsArenaMoneyrace_bot"
        self.invite = data.get("channel_invite_url")
        self.fixtures = [
            {
                "home": f["home"],
                "away": f["away"],
                "home_short": SHORT.get(f["home"], f["home"]),
                "away_short": SHORT.get(f["away"], f["away"]),
                "kickoff": dt.datetime.fromisoformat(f["kickoff"]),
            }
            for f in (data.get("fixtures") or [])
        ]

    # ---------------------------------------------------------------- money
    @property
    def prize_text(self) -> str:
        return money(self.prize, self.currency)

    # ----------------------------------------------------------------- time
    @property
    def lock_local(self) -> dt.datetime:
        return self.locks_at.astimezone(BERLIN)

    @property
    def lock_day(self) -> str:
        return _DAYS[self.lock_local.weekday()]

    @property
    def lock_clock(self) -> str:
        return self.lock_local.strftime("%H:%M") + " Uhr"

    @property
    def lock_date(self) -> str:
        d = self.lock_local
        return f"{d.day}. {_MONTHS[d.month - 1]}"

    @property
    def deadline_short(self) -> str:
        """'Sa, 15:00 Uhr' - fits a badge."""
        return f"{self.lock_day[:2]}, {self.lock_clock}"

    @property
    def deadline_long(self) -> str:
        return f"{self.lock_day}, {self.lock_date}, {self.lock_clock}"

    def days_left(self, now: dt.datetime | None = None) -> int:
        now = now or dt.datetime.now(dt.timezone.utc)
        return max(0, (self.locks_at - now).days)

    # ------------------------------------------------------------- fixtures
    @property
    def match_count(self) -> int:
        return len(self.fixtures)

    @property
    def league(self) -> str:
        leagues = {f.get("league") for f in (self.raw.get("fixtures") or [])}
        return leagues.pop() if len(leagues) == 1 else "Fußball"

    def pairs(self) -> list[str]:
        return [f"{f['home_short']} - {f['away_short']}" for f in self.fixtures]

    # --------------------------------------------------------------- wording
    @property
    def matches_worded(self) -> str:
        n = self.match_count
        return "1 Spiel" if n == 1 else f"{n} Spiele"

    @property
    def tips_worded(self) -> str:
        n = self.match_count
        return "1 Tipp" if n == 1 else f"{n} Tipps"


def load(path: pathlib.Path | None = None) -> Campaign:
    path = path or ROOT / "data" / "campaign.json"
    return Campaign(json.loads(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    c = load()
    print(f"#{c.id} {c.name}")
    print(f"  prize      {c.prize_text}  ({c.winner_count} Gewinner)")
    print(f"  deadline   {c.deadline_long}  [{c.deadline_short}]")
    print(f"  matches    {c.matches_worded}: {', '.join(c.pairs())}")
    print(f"  membership {c.requires_membership}")
    print(f"  scoring    {c.scoring}")
