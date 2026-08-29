-- The dashboard is in English from 29 Aug 2026 (his request: he does not read
-- German well). Everything a PLAYER reads - the message_templates bodies and
-- the buttons inside them - stays German, because the players are German.
--
-- This migration only moves the parts an operator reads:
--   * prize status values, which were stored as German words and shown raw
--   * the template NAMES that label the tabs on the Telegram page
--   * the settings descriptions
--
-- Safe to run twice: every statement is keyed on the old value, so a second
-- run finds nothing to change.

BEGIN;

-- ---------------------------------------------------------------- prizes
ALTER TABLE prizes ALTER COLUMN status SET DEFAULT 'pending';

UPDATE prizes SET status = 'pending' WHERE status = 'ausstehend';
UPDATE prizes SET status = 'paid'    WHERE status = 'bezahlt';
UPDATE prizes SET status = 'closed'  WHERE status = 'abgeschlossen';

-- ---------------------------------------------------------------- templates
-- Only `name` - the label on the tab. `body` is what goes out to Telegram and
-- must stay exactly as it is.
UPDATE message_templates SET name = CASE key
    WHEN 'bot_welcome'            THEN 'Bot: welcome'
    WHEN 'bot_menu'               THEN 'Bot: main menu'
    WHEN 'membership_required'    THEN 'Bot: channel membership needed'
    WHEN 'membership_ok'          THEN 'Bot: membership confirmed'
    WHEN 'membership_missing'     THEN 'Bot: membership missing'
    WHEN 'competition_intro'      THEN 'Bot: competition start'
    WHEN 'predictions_saved'      THEN 'Bot: predictions saved'
    WHEN 'predictions_locked'     THEN 'Bot: predictions closed'
    WHEN 'already_entered'        THEN 'Bot: already entered'
    WHEN 'channel_competition_new' THEN 'Channel: new competition'
    WHEN 'channel_reminder'       THEN 'Channel: reminder before lock'
    WHEN 'channel_locked'         THEN 'Channel: competition closed'
    WHEN 'channel_results'        THEN 'Channel: results'
    WHEN 'channel_winner'         THEN 'Channel: winner'
    WHEN 'channel_giveaway'       THEN 'Channel: giveaway'
    ELSE name
  END
WHERE key IN ('bot_welcome','bot_menu','membership_required','membership_ok',
              'membership_missing','competition_intro','predictions_saved',
              'predictions_locked','already_entered','channel_competition_new',
              'channel_reminder','channel_locked','channel_results',
              'channel_winner','channel_giveaway');

-- ---------------------------------------------------------------- settings
UPDATE settings SET description = CASE key
    WHEN 'brand_name'         THEN 'Brand name, shown in messages'
    WHEN 'competition_brand'  THEN 'Name of the competition format'
    WHEN 'bot_username'       THEN 'Without @. Every deep link is built from it'
    WHEN 'channel_chat_id'    THEN 'Chat ID or @name of the TippsArena channel'
    WHEN 'channel_invite_url' THEN 'Channel invite link for the JOIN CHANNEL button'
    WHEN 'timezone'           THEN 'Timezone for everything shown'
    WHEN 'currency'           THEN 'Default currency'
    WHEN 'reminder_hours_before_lock' THEN 'Hours before the lock to send the reminder'
    WHEN 'football_default_season'    THEN 'Season used by the match import'
    WHEN 'rules_text'         THEN 'Content of the rules page in the bot'
    ELSE description
  END
WHERE key IN ('brand_name','competition_brand','bot_username','channel_chat_id',
              'channel_invite_url','timezone','currency',
              'reminder_hours_before_lock','football_default_season','rules_text');

-- competition_templates.name was already English ("🏁 Bundesliga MoneyRace"),
-- so there is nothing to change there.

-- ------------------------------------------------------- one entry per person
-- He reported that after giving his predictions he could "do it twice". The
-- database could only ever hold one entry - participants is UNIQUE on
-- (competition, user) and predictions on (participant, match) - but nothing on
-- screen said so, and walking the flow a second time looks exactly like a
-- second entry. This is the screen that now says it.
INSERT INTO message_templates (key, name, body, buttons) VALUES
 ('already_entered', 'Bot: already entered',
  '✅ <b>DU BIST BEREITS DABEI</b>' || E'\n\n' ||
  '🏁 {name}' || E'\n' ||
  '💰 Preisgeld: <b>{prize}</b>' || E'\n' ||
  '🔒 Tippschluss: {lock_time}' || E'\n\n' ||
  'Deine Teilnahme zählt einmal - egal wie oft du hier hereinschaust. ' ||
  'Bis zum Tippschluss kannst du deine Tipps noch ändern.',
  '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Same point on the confirmation screen. Only touched while it still holds the
-- seeded wording, so an edit he has made is never overwritten.
UPDATE message_templates
   SET body = body || E'\n\n' ||
       'Deine Teilnahme zählt einmal. Bis zum Tippschluss kannst du deine Tipps ändern.'
 WHERE key = 'predictions_saved'
   AND body = '✅ <b>DEINE TIPPS WURDEN GESPEICHERT!</b>' || E'\n\n' ||
              '🏁 {name}' || E'\n' ||
              '🎯 {done}/{total} Tipps abgegeben' || E'\n' ||
              '💰 Preisgeld: {prize}';

COMMIT;
