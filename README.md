# TippsArena MoneyRace

Telegram-based football prediction and giveaway platform for the German market.

Everything a user reads is German and lives in the database, so the wording can
be changed without touching code. The technical naming is English.

**Status:** the engine is running. Database, Telegram funnel, football import,
scoring, ranking and the automatic worker are live and tested. The German admin
dashboard is the next piece.

---

## What runs

| Process | What it does | Service |
|---|---|---|
| `bot/index.ts` | The Telegram bot: /start, deep links, channel check, predictions | `tippsarena-bot` |
| `worker/index.ts` | Opens and locks competitions, imports results, scores, ranks, announces | `tippsarena-worker` |
| `admin/` | German web dashboard | *(next)* |

```
systemctl status tippsarena-bot tippsarena-worker
journalctl -u tippsarena-worker -f
```

## Setup

```bash
cp .env.example .env      # fill in DATABASE_URL, TELEGRAM_BOT_TOKEN, FOOTBALL_API_KEY
npm install
npm run migrate
npm test
```

`npm run migrate` is safe to run repeatedly — it applies only what has not been
applied, each file in its own transaction.

### Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Works unchanged against Supabase. |
| `TELEGRAM_BOT_TOKEN` | From BotFather. Never leaves the server. |
| `FOOTBALL_API_KEY` | API-Football key. Never leaves the server. |
| `BOT_USERNAME` | Without `@`. Every deep link is built from it. |

`.env` is in `.gitignore` and is not in this repository. Nothing in the repo
contains a token, a password or a key.

## Creating a competition before the dashboard exists

The script calls exactly the same functions the dashboard buttons will, so
anything proven here is proven for both.

```bash
node scripts/create-competition.ts \
  --name "Bundesliga MoneyRace #1" \
  --league 78 --season 2026 \
  --from 2026-08-29 --to 2026-08-30 \
  --prize 250 --matches 8 \
  --lock "2026-08-29T15:25:00+02:00" \
  --publish
```

It refuses to build a competition whose lock time is after a kick-off, because
that would let somebody predict a match already being played.

## The rules the code enforces

These are the ones worth knowing, because they are the ones that cost money if
they are wrong.

**Predictions cannot change after the lock.** One function writes to
`predictions` (`savePrediction` in `lib/competitions.ts`), it re-reads the
competition inside its own transaction, and it compares against `locks_at`
rather than the stored status — so the seconds between the lock time and the
worker's next tick are not a window. It also refuses a fixture that belongs to a
different competition, and a participant who is not in this one.

**An outage never becomes data.** A failed or empty football API call writes
nothing. Scores are stored only for a match the provider reports as finished, so
a half-time score can never be scored as a result. A result corrected by hand in
the dashboard is never overwritten by a later API poll.

**A missing result is never a winner.** If any match has no result, the
competition is marked `evaluating` with a German note, and nobody is flagged as
a winner. Evaluation is idempotent: it recomputes from the fixtures every time,
so a corrected result simply produces a corrected leaderboard.

**Ties are shared, not broken by chance.** Two entrants equal on every
configured tiebreak share a rank and the next rank skips (1, 2, 2, 4). Somebody
who never finished their picks sorts last, never first.

**Money is never moved.** A finished competition writes `prizes` rows marked
`ausstehend`. Marking one paid is a human action.

**Nothing lives in a timer.** Announcements, locks and evaluations are rows with
due times. The worker can be restarted at any second and picks up where it was.

## Configuration, not code

| Where | What the operator controls |
|---|---|
| `settings` | brand, channel, timezone, reminder timing, rules text |
| `message_templates` | every word the bot and the channel say, plus their buttons |
| `competitions.scoring` | points per correct result, exact-score bonus |
| `competitions.tiebreakers` | the ordered tiebreak list |
| `competition_templates` | the six competition shapes, pre-filled |

An unknown `{placeholder}` in a template is left visible rather than blanked, so
a typo shows up as text in a test message instead of an empty announcement.

## Tests

```bash
npm test          # both suites
npm run test:logic
npm run test:bot
```

`tests/run.ts` covers scoring, ranking, tie-breaking, payload parsing and
formatting as pure functions, then exercises the lock against a real database.
`tests/bot.ts` drives the real Telegram handlers with fake updates and
intercepts the outgoing API calls, so what is asserted is what Telegram would
have been sent — the welcome, the menu, entering, answering a match, and being
refused after the lock.

Both suites create their own data and delete it again, so they can be run twice
back to back and must give the same answer.

## Moving to Supabase

The schema is plain SQL with no Postgres extensions and no vendor features.
Point `DATABASE_URL` at the Supabase connection string and run `npm run migrate`
against it; to bring existing data, `pg_dump` and restore. Nothing else changes.
