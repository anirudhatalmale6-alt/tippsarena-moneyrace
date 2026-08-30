-- 012 - Exact Score: only the exact score scores.
--
-- His answer to the question 011 asked: "So if no one gets the exact score no
-- one gets points at all. Please fix that. only 3 points for the exact score
-- that goes to the monthly competition."
--
-- So `exact_score_prize_rule` stops being only about the prize and becomes the
-- points table for the round:
--
--   best        3 for the exact score, 1 for the right winner  (what has run)
--   exact_only  3 for the exact score, 0 for anything else
--
-- Under exact_only nobody can finish with points unless they hit the scoreline,
-- so the existing "zero points is not a win" guard already refuses to crown
-- anyone - the two rules agree instead of one overriding the other.
--
-- NOTHING HERE TOUCHES THE TWO ROUNDS ALREADY PAID. Exact Score #1 and #2 keep
-- their stored points, their winner and their paid prize. Re-scoring a finished
-- round would leave two paid prizes attached to nobody, and that is his call to
-- make, not a migration's.

BEGIN;

-- The rule itself. He asked for it, so it goes on.
INSERT INTO settings (key, value)
VALUES ('exact_score_prize_rule', '"exact_only"'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- The template that pre-fills a new Exact Score round. Belt and braces: the
-- setting already forces the 0 at scoring time, but leaving a 1 sitting in the
-- box would show him a number the evaluator ignores.
UPDATE competition_templates
   SET defaults = jsonb_set(defaults, '{scoring,correct_outcome}', '0'::jsonb)
 WHERE type = 'exact_score';

-- Under the new rule this post is the normal outcome of a round nobody wins, so
-- it has to say what happens to the money rather than leaving it to be guessed.
-- "bleibt offen" could be read as a roll-over, and there is no roll-over.
UPDATE message_templates
   SET body =
     '🎯 <b>{name} — ERGEBNIS</b>' || E'\n\n' ||
     '⚽ {match}' || E'\n' ||
     '📊 Endstand: <b>{final_score}</b>' || E'\n\n' ||
     '❌ <b>Diesmal hatte niemand das exakte Ergebnis.</b>' || E'\n' ||
     'Nur das exakte Ergebnis zählt — deshalb gibt es diese Runde keine Punkte und keinen Gewinner.' || E'\n' ||
     'Das Preisgeld von {prize} wird nicht ausgezahlt.' || E'\n\n' ||
     'Nächste Runde, nächste Chance! 🍀'
 WHERE key = 'channel_exact_no_winner';

COMMIT;
