-- Exact-score points are TOTALS, and the winner post must not claim a hit.
-- 29 Aug 2026, correcting migration 009.
--
-- 1. HIS NUMBERS ARE TOTALS.
--    He wrote: "Exact score: 3 Punkte. Correct result but incorrect exact
--    score: 1 Punkt. Wrong result: 0 Punkte." The engine was additive, so 009
--    set 1 + 2 to make 3 come out. That works right up until he edits either
--    box - which he already had on competition 77, where {1, 3} silently paid 4
--    for a hit he had asked to be worth 3.
--
--    scorePrediction now takes a mode, and an exact-score round uses "replace":
--    exact_score IS the score for a hit, correct_outcome IS the score for the
--    right result. What he types is what a player gets, which is the only
--    version he can check.
--
-- 2. THE WINNER POST CLAIMED "EXAKT RICHTIG!" UNCONDITIONALLY.
--    Competition 77's winner won on the outcome, with no scoreline stored at
--    all (its predictions predate the exact-score screen). The channel post
--    still said "Tipp: -" and "Exakt richtig!" in the same breath. The verdict
--    is now a variable, decided from what actually happened.

BEGIN;

-- 009 wrote the additive pair. Under "replace" that would pay 2 for a hit.
UPDATE competitions
   SET scoring = '{"correct_outcome":1,"exact_score":3}'::jsonb
 WHERE type = 'exact_score'
   AND scoring = '{"correct_outcome":1,"exact_score":2}'::jsonb;

-- Anything still on the original default gets his numbers too.
UPDATE competitions
   SET scoring = '{"correct_outcome":1,"exact_score":3}'::jsonb
 WHERE type = 'exact_score'
   AND scoring = '{"correct_outcome":1,"exact_score":0}'::jsonb;

-- The exact-score winner post: the verdict is passed in, not assumed.
UPDATE message_templates
   SET body = '🎯 <b>EXACT SCORE — GEWINNER</b>' || E'\n\n' ||
              '🥇 <b>{winner}</b>' || E'\n\n' ||
              '⚽ {match}' || E'\n' ||
              '{winner_line}' || E'\n' ||
              '{verdict}' || E'\n\n' ||
              'Herzlichen Glückwunsch! 🎉' || E'\n' ||
              '👉 Bitte kontaktiere {support} zur Abwicklung.'
 WHERE key = 'channel_exact_winner';

-- Same in the winner's private message.
UPDATE message_templates
   SET body = '🎯 <b>HERZLICHEN GLÜCKWUNSCH!</b>' || E'\n\n' ||
              'Du hast die Exact Score Challenge gewonnen! 🏆' || E'\n\n' ||
              '⚽ {match}' || E'\n' ||
              '{winner_line}' || E'\n' ||
              '📊 Ergebnis: <b>{final_score}</b>' || E'\n' ||
              '💰 Gewinn: <b>{prize}</b>' || E'\n\n' ||
              'Bitte kontaktiere uns:' || E'\n' ||
              '👉 <b>{support}</b>'
 WHERE key = 'winner_dm_exact';

COMMIT;
