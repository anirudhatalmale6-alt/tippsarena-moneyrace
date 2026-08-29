-- Top 3 + your own rank, and an exact-score result that cannot be misread.
-- 29 Aug 2026.
--
-- 1. THE POST HE CALLED IMPOSSIBLE.
--    Competition 146: Dortmund - HSV finished 2:0, @roktok52 had tipped 3:1,
--    and the channel said:
--
--        🎯 EXACT SCORE — GEWINNER
--        🥇 @roktok52
--        ⚽ Borussia Dortmund — Hamburger SV
--        🎯 Tipp: 3:1
--        📊 Ergebnis: 2:0
--        ✅ Richtiges Ergebnis!
--
--    The arithmetic was right - right result, wrong scoreline, 1 point of a
--    possible 3 - but the post reads as a claim that 3:1 won a 2:0 match. The
--    headline says EXACT SCORE, the tip sits above the result, and nothing
--    anywhere says "nobody got the scoreline". So the wording changes:
--    Endstand first and labelled, the verdict states the miss outright, and
--    the tip is labelled as the winner's tip with what it actually paid.
--
-- 2. AND THE QUESTION UNDERNEATH IT: should it pay at all?
--    Under his own 3/1/0 table a round with no exact hit still has a highest
--    score, so it still has a winner - which is how 100 € went to a wrong
--    scoreline. That is a business decision, not a bug, so it is a setting:
--    exact_score_prize_rule, default 'best' (what has been running).
--
-- 3. LEADERBOARD.
--    "The leaderboard must NOT display every user." The bot's ranking screens
--    now show three masked names and your own position, and are one query
--    whatever the size of the field.

BEGIN;

-- ---------------------------------------------------------------- settings
INSERT INTO settings (key, value)
VALUES ('exact_score_prize_rule', '"best"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- templates
-- The exact-score winner post, rebuilt so the two numbers cannot be swapped by
-- the eye: the result is the first number on the screen and it is named.
UPDATE message_templates
   SET body = '🎯 <b>{name} — ERGEBNIS</b>' || E'\n\n' ||
              '⚽ {match}' || E'\n' ||
              '📊 Endstand: <b>{final_score}</b>' || E'\n\n' ||
              '{verdict}' || E'\n\n' ||
              '🥇 <b>{winner}</b>' || E'\n' ||
              '{winner_line}' || E'\n' ||
              '💰 {prize}' || E'\n\n' ||
              'Herzlichen Glückwunsch! 🎉' || E'\n' ||
              '👉 Bitte kontaktiere {support} zur Abwicklung.'
 WHERE key = 'channel_exact_winner';

-- Nobody won. Only reachable with exact_score_prize_rule = 'exact_only', but
-- the channel must still say something: it announced the competition.
INSERT INTO message_templates (key, name, body)
VALUES (
  'channel_exact_no_winner',
  'Exact Score — nobody won',
  '🎯 <b>{name} — ERGEBNIS</b>' || E'\n\n' ||
  '⚽ {match}' || E'\n' ||
  '📊 Endstand: <b>{final_score}</b>' || E'\n\n' ||
  '❌ <b>Diesmal hatte niemand das exakte Ergebnis.</b>' || E'\n' ||
  'Das Preisgeld von {prize} bleibt offen.' || E'\n\n' ||
  'Nächste Runde, nächste Chance! 🍀'
)
ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, name = EXCLUDED.name;

-- The winner's own message gets the same treatment: Endstand first.
UPDATE message_templates
   SET body = '🎯 <b>HERZLICHEN GLÜCKWUNSCH!</b>' || E'\n\n' ||
              'Du hast die Exact Score Challenge gewonnen! 🏆' || E'\n\n' ||
              '⚽ {match}' || E'\n' ||
              '📊 Endstand: <b>{final_score}</b>' || E'\n' ||
              '{winner_line}' || E'\n\n' ||
              '💰 Gewinn: <b>{prize}</b>' || E'\n\n' ||
              'Bitte kontaktiere uns:' || E'\n' ||
              '👉 <b>{support}</b>'
 WHERE key = 'winner_dm_exact';

-- ---------------------------------------------------------------- indexes
-- The all-time table groups every participant row of one competition type. At
-- ten thousand players that is the only scan in the query, so give it the two
-- columns it reads.
CREATE INDEX IF NOT EXISTS participants_user_points_idx
  ON participants (user_id, points);
CREATE INDEX IF NOT EXISTS competitions_type_status_idx
  ON competitions (type, status);

COMMIT;
