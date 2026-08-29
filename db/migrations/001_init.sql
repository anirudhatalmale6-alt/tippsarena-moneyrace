-- TippsArena MoneyRace - initial schema.
--
-- Plain SQL on purpose. It runs unchanged on a local PostgreSQL and on Supabase,
-- so the choice of host is not baked into the application (spec §48: no lock-in).
--
-- Naming is English; every string a person ever reads is German and lives in
-- message_templates or settings, not in here.

BEGIN;

-- ---------------------------------------------------------------- settings
-- One row per knob. Everything the operator can change without a developer
-- ends up here or in a competition's own JSON columns.
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- admin
CREATE TABLE admin_users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT,
    role          TEXT NOT NULL DEFAULT 'admin',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every state-changing admin action, kept for good (spec §35).
CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    admin_user_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
    action        TEXT NOT NULL,
    entity        TEXT,
    entity_id     TEXT,
    summary       TEXT NOT NULL,
    before_state  JSONB,
    after_state   JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- ---------------------------------------------------------------- acquisition
-- Where a user came from. Created on demand the first time a deep link with an
-- unknown code arrives, so a new ad campaign needs no admin work to be tracked.
CREATE TABLE campaign_sources (
    id         BIGSERIAL PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    label      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                 BIGSERIAL PRIMARY KEY,
    telegram_id        BIGINT NOT NULL UNIQUE,
    username           TEXT,
    first_name         TEXT,
    last_name          TEXT,
    language_code      TEXT,
    is_blocked         BOOLEAN NOT NULL DEFAULT FALSE,
    campaign_source_id BIGINT REFERENCES campaign_sources(id) ON DELETE SET NULL,
    start_payload      TEXT,
    referred_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    channel_member     BOOLEAN,
    channel_checked_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_campaign_idx ON users (campaign_source_id);
CREATE INDEX users_referred_idx ON users (referred_by);
CREATE INDEX users_created_idx  ON users (created_at DESC);

-- The referral edge is its own row as well as a column on users, because the
-- column answers "who invited me" in one lookup and the table is what carries
-- the qualification state and the timestamps.
CREATE TABLE referrals (
    id           BIGSERIAL PRIMARY KEY,
    referrer_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    qualified    BOOLEAN NOT NULL DEFAULT FALSE,
    qualified_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (referred_id)
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_id);

-- ---------------------------------------------------------------- football
-- One row per real match, shared by every competition that uses it. The
-- provider's own id is kept and is what the result import matches on (spec §12).
CREATE TABLE fixtures (
    id           BIGSERIAL PRIMARY KEY,
    provider     TEXT NOT NULL DEFAULT 'api-football',
    external_id  BIGINT NOT NULL,
    league_id    INTEGER,
    league_name  TEXT,
    season       INTEGER,
    round        TEXT,
    home_team    TEXT NOT NULL,
    away_team    TEXT NOT NULL,
    home_team_id INTEGER,
    away_team_id INTEGER,
    kickoff_at   TIMESTAMPTZ NOT NULL,
    status       TEXT NOT NULL DEFAULT 'NS',
    home_goals   INTEGER,
    away_goals   INTEGER,
    -- 'H', 'D' or 'A'. Derived from the goals, never entered by hand, so the
    -- scoring never has to decide what a result means.
    outcome      CHAR(1),
    finished_at  TIMESTAMPTZ,
    manual       BOOLEAN NOT NULL DEFAULT FALSE,
    raw          JSONB,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, external_id)
);
CREATE INDEX fixtures_kickoff_idx ON fixtures (kickoff_at);
CREATE INDEX fixtures_status_idx  ON fixtures (status);

-- ---------------------------------------------------------------- competitions
CREATE TABLE competition_templates (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    defaults   JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- type:   moneyrace | exact_score | giveaway | jackpot | monthly
-- status: draft | open | locked | evaluating | finished | cancelled
--
-- The status is advanced by the worker on the clock, never by hand in the normal
-- case, but an operator can force it. Anything time-based is stored as an
-- absolute timestamptz so a change of server timezone cannot move a lock.
CREATE TABLE competitions (
    id                    BIGSERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    slug                  TEXT UNIQUE,
    type                  TEXT NOT NULL DEFAULT 'moneyrace',
    status                TEXT NOT NULL DEFAULT 'draft',
    description           TEXT,
    prize_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency              TEXT NOT NULL DEFAULT 'EUR',
    winner_count          INTEGER NOT NULL DEFAULT 1,
    requires_membership   BOOLEAN NOT NULL DEFAULT TRUE,
    channel_chat_id       TEXT,
    opens_at              TIMESTAMPTZ,
    locks_at              TIMESTAMPTZ,
    ends_at               TIMESTAMPTZ,
    -- Scoring and tie-breaking are data, not code, so the operator can change
    -- them per competition without a developer (spec §9 and §10).
    scoring               JSONB NOT NULL DEFAULT
        '{"correct_outcome": 1, "exact_score": 0}'::jsonb,
    tiebreakers           JSONB NOT NULL DEFAULT
        '["points", "exact_hits", "submitted_at"]'::jsonb,
    -- jackpot only
    jackpot_amount        NUMERIC(12,2),
    jackpot_increment     NUMERIC(12,2),
    rolled_over_from      BIGINT REFERENCES competitions(id) ON DELETE SET NULL,
    template_id           BIGINT REFERENCES competition_templates(id) ON DELETE SET NULL,
    -- set when the evaluation could not finish, e.g. a result never arrived
    evaluation_note       TEXT,
    published_at          TIMESTAMPTZ,
    locked_at             TIMESTAMPTZ,
    evaluated_at          TIMESTAMPTZ,
    created_by            BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX competitions_status_idx ON competitions (status);
CREATE INDEX competitions_locks_idx  ON competitions (locks_at);

-- The matches chosen for one competition, in the order the bot asks about them.
CREATE TABLE competition_fixtures (
    id             BIGSERIAL PRIMARY KEY,
    competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    fixture_id     BIGINT NOT NULL REFERENCES fixtures(id) ON DELETE RESTRICT,
    position       INTEGER NOT NULL,
    UNIQUE (competition_id, fixture_id),
    UNIQUE (competition_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE participants (
    id             BIGSERIAL PRIMARY KEY,
    competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- set the moment the last prediction of the set is stored; this is the
    -- timestamp the "earliest completed submission" tiebreak reads
    submitted_at   TIMESTAMPTZ,
    completed      BOOLEAN NOT NULL DEFAULT FALSE,
    points         INTEGER NOT NULL DEFAULT 0,
    exact_hits     INTEGER NOT NULL DEFAULT 0,
    correct_count  INTEGER NOT NULL DEFAULT 0,
    rank           INTEGER,
    is_winner      BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (competition_id, user_id)
);
CREATE INDEX participants_comp_idx  ON participants (competition_id);
CREATE INDEX participants_user_idx  ON participants (user_id);
CREATE INDEX participants_rank_idx  ON participants (competition_id, rank);

-- One row per match per participant. pick is the 1X2 answer; home_goals and
-- away_goals carry an exact-score answer. A row can hold both, which is what
-- lets an exact-score bonus sit on top of a normal MoneyRace without a second
-- table (spec §8: adding a prediction type must stay cheap).
CREATE TABLE predictions (
    id                      BIGSERIAL PRIMARY KEY,
    participant_id          BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    competition_fixture_id  BIGINT NOT NULL REFERENCES competition_fixtures(id) ON DELETE CASCADE,
    pick                    CHAR(1),
    home_goals              INTEGER,
    away_goals              INTEGER,
    points                  INTEGER NOT NULL DEFAULT 0,
    is_correct              BOOLEAN,
    is_exact                BOOLEAN,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (participant_id, competition_fixture_id),
    CONSTRAINT predictions_pick_valid CHECK (pick IS NULL OR pick IN ('H','D','A'))
);
CREATE INDEX predictions_participant_idx ON predictions (participant_id);

-- ---------------------------------------------------------------- giveaways
-- A giveaway is a competition of type 'giveaway'; entering it creates a
-- participants row like anything else. This table records the draw itself, with
-- enough detail to show afterwards that it was fair (spec §17).
CREATE TABLE draws (
    id             BIGSERIAL PRIMARY KEY,
    competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    winner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    pool_size      INTEGER NOT NULL,
    pool_snapshot  JSONB NOT NULL,
    seed           TEXT NOT NULL,
    drawn_by       BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
    drawn_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX draws_comp_idx ON draws (competition_id);

-- ---------------------------------------------------------------- prizes
-- status: ausstehend | bezahlt | abgeschlossen  (the operator's own words)
-- Money is never moved by this system - a prize is a note that says what is
-- owed and whether he has paid it (spec §29).
CREATE TABLE prizes (
    id             BIGSERIAL PRIMARY KEY,
    competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    rank           INTEGER,
    amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'EUR',
    status         TEXT NOT NULL DEFAULT 'ausstehend',
    notes          TEXT,
    paid_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX prizes_comp_idx   ON prizes (competition_id);
CREATE INDEX prizes_status_idx ON prizes (status);

-- ---------------------------------------------------------------- messaging
-- Every word the bot or the channel ever says, editable in the dashboard.
-- {placeholders} are filled at send time; the set of them is per key and is
-- documented in the dashboard next to the field.
CREATE TABLE message_templates (
    id          BIGSERIAL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    body        TEXT NOT NULL,
    buttons     JSONB NOT NULL DEFAULT '[]'::jsonb,
    parse_mode  TEXT NOT NULL DEFAULT 'HTML',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What was actually sent, so a failed announcement can be found and retried
-- rather than quietly lost (spec §37).
CREATE TABLE telegram_messages (
    id             BIGSERIAL PRIMARY KEY,
    competition_id BIGINT REFERENCES competitions(id) ON DELETE SET NULL,
    chat_id        TEXT NOT NULL,
    message_id     BIGINT,
    template_key   TEXT,
    body           TEXT,
    status         TEXT NOT NULL DEFAULT 'sent',
    error          TEXT,
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX telegram_messages_comp_idx ON telegram_messages (competition_id);

-- Scheduled announcements. Rows, not timers: a restart must not lose them.
-- kind: opened | reminder | locked | results | winner
CREATE TABLE notifications (
    id             BIGSERIAL PRIMARY KEY,
    competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,
    audience       TEXT NOT NULL DEFAULT 'channel',
    due_at         TIMESTAMPTZ NOT NULL,
    sent_at        TIMESTAMPTZ,
    attempts       INTEGER NOT NULL DEFAULT 0,
    last_error     TEXT,
    UNIQUE (competition_id, kind, audience)
);
CREATE INDEX notifications_due_idx ON notifications (due_at) WHERE sent_at IS NULL;

COMMIT;
