-- Defaults. Everything in here is editable from the dashboard afterwards - this
-- file only decides what the operator sees on day one, so that nothing is blank
-- and nothing had to be typed before the first competition can run.
--
-- Written to be safe to run twice: every insert is ON CONFLICT DO NOTHING, so a
-- re-run never overwrites wording the operator has since changed.

BEGIN;

-- ---------------------------------------------------------------- settings
INSERT INTO settings (key, value, description) VALUES
 ('brand_name',        '"TippsArena"'::jsonb,
  'Markenname, erscheint in Nachrichten'),
 ('competition_brand', '"MoneyRace"'::jsonb,
  'Name des Wettbewerbsformats'),
 ('bot_username',      '"TippsArenaMoneyrace_bot"'::jsonb,
  'Ohne @. Alle Deep-Links werden daraus gebaut'),
 ('channel_chat_id',   'null'::jsonb,
  'Chat-ID oder @name des TippsArena-Kanals'),
 ('channel_invite_url','null'::jsonb,
  'Einladungslink des Kanals für den KANAL-BEITRETEN-Button'),
 ('timezone',          '"Europe/Berlin"'::jsonb,
  'Zeitzone für alle Anzeigen'),
 ('currency',          '"EUR"'::jsonb, 'Standardwährung'),
 ('reminder_hours_before_lock', '1'::jsonb,
  'Stunden vor Tippschluss für die Erinnerung'),
 ('football_default_season',    '2026'::jsonb,
  'Saison für den Spiele-Import'),
 ('rules_text',
  '"📜 <b>REGELN</b>\n\nDiese Regeln kannst du im Dashboard ändern."'::jsonb,
  'Inhalt der Regeln-Seite im Bot')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- templates
-- The {curly} names are filled at send time. Anything unknown is left as it is
-- rather than throwing, so a typo in the dashboard cannot stop an announcement.
INSERT INTO message_templates (key, name, body, buttons) VALUES

 ('bot_welcome', 'Bot: Willkommen',
  '🏁 <b>WILLKOMMEN BEI TIPPSARENA MONEYRACE</b>' || E'\n\n' ||
  'Jede Woche kämpfen Fußballfans um Punkte und Preisgeld.' || E'\n\n' ||
  '⚽ Fußball-Tipps' || E'\n' ||
  '🏆 Ranglisten' || E'\n' ||
  '💰 Gewinne' || E'\n' ||
  '🎁 Giveaways' || E'\n\n' ||
  'Die Teilnahme ist kostenlos.',
  '[{"text":"🏁 JETZT STARTEN","action":"menu"}]'::jsonb),

 ('bot_menu', 'Bot: Hauptmenü',
  '🏁 <b>TIPPSARENA MONEYRACE</b>' || E'\n\n' ||
  'Wähle aus, was du machen möchtest.',
  '[]'::jsonb),

 ('membership_required', 'Bot: Kanal-Mitgliedschaft nötig',
  '🏆 Um an der MoneyRace teilzunehmen, musst du zuerst unserem kostenlosen ' ||
  'TippsArena-Kanal beitreten.',
  -- Parenthesised: :: binds tighter than ||, so without these brackets the cast
  -- applies to the second half only and Postgres is handed half a JSON array.
  ('[{"text":"📲 KANAL BEITRETEN","action":"channel"},' ||
   ' {"text":"✅ MITGLIEDSCHAFT PRÜFEN","action":"check_membership"}]')::jsonb),

 ('membership_ok', 'Bot: Mitgliedschaft bestätigt',
  '✅ <b>Mitgliedschaft bestätigt!</b>', '[]'::jsonb),

 ('membership_missing', 'Bot: Mitgliedschaft fehlt',
  '❌ Du bist noch nicht Mitglied unseres Kanals.', '[]'::jsonb),

 ('competition_intro', 'Bot: Wettbewerb starten',
  '🏁 <b>{name}</b>' || E'\n\n' ||
  '💰 Preisgeld: <b>{prize}</b>' || E'\n' ||
  '⚽ {match_count} Spiele' || E'\n' ||
  '🔒 Tippschluss: {lock_time}' || E'\n\n' ||
  'Tippe auf START und gib deine Tipps ab.',
  '[]'::jsonb),

 ('predictions_saved', 'Bot: Tipps gespeichert',
  '✅ <b>DEINE TIPPS WURDEN GESPEICHERT!</b>' || E'\n\n' ||
  '🏁 {name}' || E'\n' ||
  '🎯 {done}/{total} Tipps abgegeben' || E'\n' ||
  '💰 Preisgeld: {prize}',
  '[]'::jsonb),

 ('predictions_locked', 'Bot: Tipps geschlossen',
  '🔒 <b>DIE TIPPS SIND BEREITS GESCHLOSSEN.</b>' || E'\n\n' ||
  'Der nächste Wettbewerb kommt bald - bleib dran.',
  '[]'::jsonb),

 ('channel_competition_new', 'Kanal: Neuer Wettbewerb',
  '🏁 <b>{name} STARTET!</b>' || E'\n\n' ||
  '💰 {prize} PREISGELD' || E'\n' ||
  '⚽ {match_count} Spiele' || E'\n' ||
  '🎯 {match_count} Tipps' || E'\n' ||
  '🏆 {winner_count} Gewinner' || E'\n' ||
  '🔒 Tippschluss: {lock_time}',
  '[{"text":"🏁 JETZT TEILNEHMEN","action":"deeplink"}]'::jsonb),

 ('channel_reminder', 'Kanal: Erinnerung vor Tippschluss',
  '⏰ <b>Noch {hours} Stunde! Deine Tipps abgeben!</b>' || E'\n\n' ||
  '🏁 {name}' || E'\n' ||
  '💰 {prize}',
  '[{"text":"🏁 JETZT TEILNEHMEN","action":"deeplink"}]'::jsonb),

 ('channel_locked', 'Kanal: Wettbewerb geschlossen',
  '🔒 <b>{name} GESCHLOSSEN</b>' || E'\n\n' ||
  '{participants} Teilnehmer sind dabei. Viel Glück!',
  '[]'::jsonb),

 ('channel_results', 'Kanal: Ergebnisse',
  '🏆 <b>DIE ERGEBNISSE SIND DA!</b>' || E'\n\n' ||
  '🏁 {name}' || E'\n\n' || '{leaderboard}',
  '[{"text":"🏆 LEADERBOARD","action":"deeplink"}]'::jsonb),

 ('channel_winner', 'Kanal: Gewinner',
  '🥇 <b>GLÜCKWUNSCH {winner}!</b>' || E'\n\n' ||
  '🏁 {name}' || E'\n' ||
  '💰 {prize}',
  '[]'::jsonb),

 ('channel_giveaway', 'Kanal: Giveaway',
  '🎁 <b>{prize} GIVEAWAY</b>' || E'\n\n' || '{description}',
  '[{"text":"🎁 TEILNEHMEN","action":"deeplink"}]'::jsonb)

ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- templates
-- The six competition shapes from the spec. Picking one pre-fills the form; the
-- operator still chooses matches, prize and times.
INSERT INTO competition_templates (name, type, sort_order, defaults) VALUES
 ('🏁 Bundesliga MoneyRace', 'moneyrace', 1,
  '{"league_id":78,"match_count":10,"prize_amount":250,"requires_membership":true,
    "scoring":{"correct_outcome":1,"exact_score":0}}'::jsonb),
 ('🏁 Champions League MoneyRace', 'moneyrace', 2,
  '{"league_id":2,"match_count":10,"prize_amount":250,"requires_membership":true,
    "scoring":{"correct_outcome":1,"exact_score":0}}'::jsonb),
 ('🏁 Europa League MoneyRace', 'moneyrace', 3,
  '{"league_id":3,"match_count":10,"prize_amount":150,"requires_membership":true,
    "scoring":{"correct_outcome":1,"exact_score":0}}'::jsonb),
 ('🎯 Exact Score', 'exact_score', 4,
  '{"match_count":1,"prize_amount":100,"requires_membership":true,
    "scoring":{"correct_outcome":0,"exact_score":3}}'::jsonb),
 ('🎁 Random Giveaway', 'giveaway', 5,
  '{"match_count":0,"prize_amount":100,"requires_membership":true}'::jsonb),
 ('🔥 Jackpot', 'jackpot', 6,
  '{"match_count":10,"prize_amount":100,"requires_membership":true,
    "jackpot_increment":100,"scoring":{"correct_outcome":1,"exact_score":0}}'::jsonb),
 ('🏆 Monthly Championship', 'monthly', 7,
  '{"match_count":0,"prize_amount":500,"requires_membership":true}'::jsonb)
ON CONFLICT DO NOTHING;

COMMIT;
