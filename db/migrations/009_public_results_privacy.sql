-- Public results: the winner, never the list. 29 Aug 2026.
--
-- What was wrong: when a competition finished, the worker queued a `results`
-- notification whose template was "{leaderboard}" - the top ten, by username,
-- straight into the public channel, automatically. With 100 entrants that is a
-- public list of 100 people who never agreed to be listed. It has already
-- happened once (competition 77).
--
-- His correction is precise, and it is not "hide the winner":
--   * the WINNER is public, by full @username, on purpose
--   * optionally the top 3
--   * never anybody else
--   * the full table stays inside the bot and the dashboard
--
-- So the full-leaderboard template is DELETED rather than left switched off. A
-- template that exists is a template somebody can send; the requirement is that
-- there is no way to post the whole list, not that the default is safer.

BEGIN;

-- --------------------------------------------------------------- the setting
INSERT INTO settings (key, value, description) VALUES
 ('public_result_mode', '"winner"'::jsonb,
  'What goes in the channel when a competition finishes: winner | top3 | none')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------- the leak, removed for good
DELETE FROM message_templates WHERE key = 'channel_results';
-- Nothing may queue it either.
DELETE FROM notifications WHERE kind = 'results' AND sent_at IS NULL;

-- ---------------------------------------------------------------- announcements
INSERT INTO message_templates (key, name, body, buttons) VALUES

 ('channel_winner_only', 'Channel: winner (MoneyRace)',
  '🏆 <b>{name} — GEWINNER</b>' || E'\n\n' ||
  '🥇 <b>{winner}</b>' || E'\n\n' ||
  'Herzlichen Glückwunsch! 🎉' || E'\n' ||
  '🏆 {winner_points}' || E'\n\n' ||
  'Der Gewinner wurde bereits privat über den Bot benachrichtigt.' || E'\n' ||
  '👉 Bitte kontaktiere {support} zur Abwicklung deines Gewinns.' || E'\n\n' ||
  '🔥 Das nächste MoneyRace kommt bald!',
  '[{"text":"🏁 BEIM NÄCHSTEN DABEI SEIN","action":"deeplink"}]'::jsonb),

 ('channel_top3', 'Channel: top 3',
  '🏆 <b>{name}</b>' || E'\n\n' ||
  '{podium}' || E'\n\n' ||
  'Glückwunsch an die Gewinner! 🎉' || E'\n\n' ||
  '👉 Bitte kontaktiere {support} zur Abwicklung.',
  '[{"text":"🏁 BEIM NÄCHSTEN DABEI SEIN","action":"deeplink"}]'::jsonb),

 ('channel_exact_winner', 'Channel: winner (Exact Score)',
  '🎯 <b>EXACT SCORE — GEWINNER</b>' || E'\n\n' ||
  '🥇 <b>{winner}</b>' || E'\n\n' ||
  '⚽ {match}' || E'\n' ||
  '🎯 Tipp: <b>{winner_tip}</b>' || E'\n' ||
  '🏆 Exakt richtig!' || E'\n\n' ||
  'Herzlichen Glückwunsch! 🎉' || E'\n' ||
  '👉 Bitte kontaktiere {support} zur Abwicklung.',
  '[{"text":"🎯 BEIM NÄCHSTEN DABEI SEIN","action":"deeplink"}]'::jsonb),

 -- Nobody has a public username: say the draw happened, name no one, and never
 -- fall back to a first name or a Telegram id.
 ('channel_winner_anonymous', 'Channel: winner has no username',
  '🏆 <b>{name}</b>' || E'\n\n' ||
  'Der Gewinner steht fest und wurde direkt über Telegram benachrichtigt. 🎉' || E'\n\n' ||
  'Vielen Dank an alle Teilnehmer!' || E'\n\n' ||
  '🔥 Die nächste Runde kommt bald.',
  '[{"text":"🏁 BEIM NÄCHSTEN DABEI SEIN","action":"deeplink"}]'::jsonb),

-- ---------------------------------------------------------------- private DMs
 ('winner_dm_moneyrace', 'Winner DM: MoneyRace',
  '🏆 <b>HERZLICHEN GLÜCKWUNSCH!</b>' || E'\n\n' ||
  'Du hast das MoneyRace gewonnen! 🎉' || E'\n\n' ||
  '🥇 Platz {rank}' || E'\n' ||
  '🏆 {winner_points}' || E'\n' ||
  '💰 Gewinn: <b>{prize}</b>' || E'\n\n' ||
  'Bitte kontaktiere uns zur Abwicklung deines Gewinns:' || E'\n' ||
  '👉 <b>{support}</b>',
  '[]'::jsonb),

 ('winner_dm_exact', 'Winner DM: Exact Score',
  '🎯 <b>HERZLICHEN GLÜCKWUNSCH!</b>' || E'\n\n' ||
  'Du hast die Exact Score Challenge gewonnen! 🏆' || E'\n\n' ||
  '⚽ {match}' || E'\n' ||
  '🎯 Dein Tipp: <b>{winner_tip}</b>' || E'\n' ||
  '📊 Ergebnis: <b>{final_score}</b>' || E'\n' ||
  '💰 Gewinn: <b>{prize}</b>' || E'\n\n' ||
  'Bitte kontaktiere uns:' || E'\n' ||
  '👉 <b>{support}</b>',
  '[]'::jsonb)

ON CONFLICT (key) DO NOTHING;

-- His handle, for every "contact us" line above.
UPDATE settings SET value = '"@thomastippsarena"'::jsonb
 WHERE key = 'support_handle' AND value = '"@tippsarena"'::jsonb;

-- ------------------------------------------------- exact-score default scoring
-- His §4: exact = 3, right outcome wrong score = 1, wrong = 0. The engine is
-- additive (outcome points + an exact bonus), so 1 + 2 produces exactly that.
-- Only rounds still using the plain default are touched - anything he has
-- already tuned by hand is left alone.
UPDATE competitions
   SET scoring = '{"correct_outcome":1,"exact_score":2}'::jsonb
 WHERE type = 'exact_score'
   AND scoring = '{"correct_outcome":1,"exact_score":0}'::jsonb;

COMMIT;
