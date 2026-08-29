-- Announcement wording per competition type, 29 Aug 2026 (evening).
--
-- Three things he reported:
--
--  1. The giveaway button in a channel post / broadcast opened a screen with a
--     SECOND "TEILNEHMEN" on it. Pressing the same word twice reads as the
--     first press not working. The button now uses giveaway_deeplink, which
--     carries start=g_<id> and enters the person on arrival.
--
--  2. An exact-score competition was announced with the MoneyRace text:
--     "⚽ 1 Spiele · 🎯 1 Tipps". Wrong plural, and wrong shape - an exact-score
--     round is one match and one scoreline, not a list of them.
--
--  3. "winners can be more they can split the money if there are more with the
--     same score". True of every type: rank() gives tied people the same rank
--     and winners() returns all of them. That was never said out loud in any
--     announcement, so it is now in the text.
--
-- The counts arrive pre-formatted from the renderer ({matches} = "1 Spiel" or
-- "5 Spiele") because German plurals cannot be done with a placeholder and a
-- number. {match_count} still works for anything he has already edited.

BEGIN;

-- ------------------------------------------------------------ 1. one tap
UPDATE message_templates
   SET buttons = '[{"text":"🎁 AM GIVEAWAY TEILNEHMEN","action":"giveaway_deeplink"}]'::jsonb
 WHERE key = 'channel_giveaway';

-- ------------------------------------------------- 2. exact score gets its own
INSERT INTO message_templates (key, name, body, buttons) VALUES
 ('channel_exact_new', 'Channel: new exact-score round',
  '🎯 <b>{name}</b>' || E'\n\n' ||
  '💰 <b>{prize}</b> für das genaue Ergebnis' || E'\n' ||
  '⚽ {match}' || E'\n' ||
  '🔒 Tippschluss: {lock_time}' || E'\n\n' ||
  'Tippe das <b>exakte Endergebnis</b>. Wer es trifft, gewinnt.' || E'\n' ||
  'Treffen mehrere das Ergebnis, wird das Preisgeld geteilt.' || E'\n\n' ||
  '🆓 Kostenlos. Kein Einsatz.',
  '[{"text":"🎯 JETZT TIPPEN","action":"deeplink"}]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------- 3. correct plurals + the split rule
-- Keyed on the exact seeded text, so an edit of his is never overwritten.
UPDATE message_templates
   SET body = '🏁 <b>{name} STARTET!</b>' || E'\n\n' ||
              '💰 <b>{prize}</b> PREISGELD' || E'\n' ||
              '⚽ {matches}' || E'\n' ||
              '🏆 {winners}' || E'\n' ||
              '🔒 Tippschluss: {lock_time}' || E'\n\n' ||
              'Bei Gleichstand wird das Preisgeld geteilt.' || E'\n' ||
              '🆓 Kostenlos. Kein Einsatz.'
 WHERE key = 'channel_competition_new'
   AND body LIKE '%{match_count}%';

COMMIT;
