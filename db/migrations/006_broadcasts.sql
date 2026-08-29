-- Broadcasts, 29 Aug 2026.
--
-- He asked to be able to announce a new MoneyRace from the dashboard. The
-- announcement already existed as something the WORKER sends when a competition
-- is published; this makes it a thing he can fire himself, at any moment, to the
-- channel and/or to everyone who has ever started the bot.
--
-- Why a table and not just "send it in the button handler":
--
--  * A direct message goes to one person at a time. With 2 users that is
--    instant; with 5,000 it is minutes, and a web request that takes minutes is
--    a web request that dies half way. So the button writes a row and the worker
--    does the sending.
--  * cursor_user_id is the resume point. The worker only ever sends to users
--    with a HIGHER id and moves the cursor as it goes, so a restart in the
--    middle continues rather than starting again. Without it, a crash at 80%
--    would send the same advert to those 80% a second time.
--  * channel_message_id is the same guarantee for the channel half: set once,
--    and a non-null value means "already posted, do not post again".

BEGIN;

CREATE TABLE IF NOT EXISTS broadcasts (
  id                 BIGSERIAL PRIMARY KEY,
  competition_id     BIGINT REFERENCES competitions(id) ON DELETE SET NULL,
  -- channel | users | both
  audience           TEXT        NOT NULL DEFAULT 'channel',
  template_key       TEXT,
  body               TEXT        NOT NULL,
  buttons            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- queued | sending | done | failed
  status             TEXT        NOT NULL DEFAULT 'queued',
  recipients         INTEGER     NOT NULL DEFAULT 0,
  sent               INTEGER     NOT NULL DEFAULT 0,
  failed             INTEGER     NOT NULL DEFAULT 0,
  cursor_user_id     BIGINT      NOT NULL DEFAULT 0,
  channel_message_id BIGINT,
  error              TEXT,
  created_by         BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS broadcasts_open_idx
  ON broadcasts (created_at) WHERE status IN ('queued', 'sending');

COMMIT;
