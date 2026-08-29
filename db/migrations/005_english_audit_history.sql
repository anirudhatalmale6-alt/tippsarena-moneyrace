-- The audit log is shown on the dashboard, so the rows written before the
-- dashboard became English are the last German text an operator would see.
--
-- Only the wording changes. The action, the target and the timestamp - the
-- parts that make this a record of what happened - are untouched, and nothing
-- here can match a row written after 004, so a second run does nothing.

BEGIN;

UPDATE audit_logs SET summary =
  regexp_replace(summary,
    '^([0-9]+) Spiele importiert \(Liga ([0-9]+), (.+) bis (.+)\)$',
    '\1 matches imported (league \2, \3 to \4)')
WHERE summary LIKE '% Spiele importiert (Liga %';

UPDATE audit_logs SET summary =
  regexp_replace(summary, '^Wettbewerb "(.+)" angelegt$', 'Competition "\1" created')
WHERE summary LIKE 'Wettbewerb "%" angelegt';

UPDATE audit_logs SET summary =
  regexp_replace(summary, '^([0-9]+) Spiele zugeordnet$', '\1 matches assigned')
WHERE summary LIKE '% Spiele zugeordnet';

-- Two spellings exist: one row was written before 003 fixed the umlauts.
UPDATE audit_logs SET summary =
  regexp_replace(summary, '^Wettbewerb "(.+)" (veröffentlicht|veroeffentlicht)$',
                 'Competition "\1" published')
WHERE summary LIKE 'Wettbewerb "%" ver%ffentlicht'
   OR summary LIKE 'Wettbewerb "%" veroeffentlicht';

UPDATE audit_logs SET summary = 'Settings changed'
WHERE summary IN ('Einstellungen geändert', 'Einstellungen geaendert');

UPDATE audit_logs SET summary =
  regexp_replace(summary, '^Wettbewerb #([0-9]+) geändert$', 'Competition #\1 changed')
WHERE summary LIKE 'Wettbewerb #%geändert';

UPDATE audit_logs SET summary =
  regexp_replace(summary, '^Gewinner aus ([0-9]+) Teilnehmern gelost$',
                 'Winner drawn from \1 participants')
WHERE summary LIKE 'Gewinner aus % Teilnehmern gelost';

COMMIT;
