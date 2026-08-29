-- Spelling fix for the seeded German text.
--
-- 002 was written with ae/oe/ue/ss stand-ins out of habit. Spec §42 asks for
-- proper German everywhere a person reads, and these strings are read by users
-- in the bot and by the operator in the dashboard.
--
-- Done as targeted replace() rather than by rewriting the rows, so it fixes the
-- spelling without touching anything the operator may have edited around it,
-- and running it twice changes nothing the second time.

BEGIN;

UPDATE message_templates SET body =
  replace(replace(replace(replace(replace(replace(replace(replace(
    body,
    'Fussball',      'Fußball'),
    'kaempfen',      'kämpfen'),
    'Waehle',        'Wähle'),
    'moechtest',     'möchtest'),
    'bestaetigt',    'bestätigt'),
    'naechste',      'nächste'),
    'Viel Glueck',   'Viel Glück'),
    'GLUECKWUNSCH',  'GLÜCKWUNSCH')
WHERE body <> replace(replace(replace(replace(replace(replace(replace(replace(
    body,
    'Fussball',      'Fußball'),
    'kaempfen',      'kämpfen'),
    'Waehle',        'Wähle'),
    'moechtest',     'möchtest'),
    'bestaetigt',    'bestätigt'),
    'naechste',      'nächste'),
    'Viel Glueck',   'Viel Glück'),
    'GLUECKWUNSCH',  'GLÜCKWUNSCH');

UPDATE message_templates SET buttons =
  replace(buttons::text, 'MITGLIEDSCHAFT PRUEFEN', 'MITGLIEDSCHAFT PRÜFEN')::jsonb
WHERE buttons::text LIKE '%PRUEFEN%';

UPDATE message_templates SET name =
  replace(replace(replace(name,
    'Hauptmenue',  'Hauptmenü'),
    'noetig',      'nötig'),
    'bestaetigt',  'bestätigt')
WHERE name LIKE '%menue%' OR name LIKE '%noetig%' OR name LIKE '%bestaetigt%';

UPDATE settings SET description =
  replace(replace(replace(replace(description,
    'fuer',              'für'),
    'Standardwaehrung',  'Standardwährung'),
    'aendern',           'ändern'),
    'Waehrung',          'Währung')
WHERE description LIKE '%fuer%' OR description LIKE '%waehrung%'
   OR description LIKE '%aendern%' OR description LIKE '%Waehrung%';

UPDATE settings SET value = to_jsonb(
    replace(value #>> '{}', 'aendern', 'ändern'))
WHERE key = 'rules_text' AND value #>> '{}' LIKE '%aendern%';

COMMIT;
