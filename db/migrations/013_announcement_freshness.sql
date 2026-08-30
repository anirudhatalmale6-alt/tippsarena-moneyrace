-- A queued announcement is a claim about the future, and the future can change.
--
-- What happened: giveaway 57 was published on 29 Aug with an end time of
-- 30 Aug 11:17. Publishing queued a "one hour to go, get your tips in"
-- reminder for 10:17 the next day. The winner was drawn and announced 22
-- hours BEFORE that, so by the time the reminder came due the giveaway was
-- finished, its winner was public - and the message went out anyway, into the
-- channel, telling people to submit tips for a giveaway that has no tips and
-- was already over. Nobody pressed anything; the row was simply due.
--
-- The sender's only condition was "due_at <= now() AND sent_at IS NULL". It
-- never asked whether the message was still TRUE. This migration gives it a
-- place to record that it decided not to send, so a skipped announcement is
-- visible in the dashboard rather than vanishing.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS skip_reason TEXT;

-- Any announcement still waiting that is no longer true is retired here rather
-- than left for the worker to send once. Same rules as
-- notificationStillTrue() in lib/announcements.ts - written twice on purpose:
-- the code protects every future row, this protects the rows that already
-- exist right now, and neither depends on the other having run.
UPDATE notifications n
   SET skipped_at = now(),
       skip_reason = 'retired by migration 013: no longer true when it came due'
  FROM competitions c
 WHERE c.id = n.competition_id
   AND n.sent_at IS NULL
   AND n.skipped_at IS NULL
   AND (
        (c.type = 'giveaway' AND n.kind IN ('reminder', 'locked'))
     OR (n.kind = 'opened'   AND c.status <> 'open')
     OR (n.kind = 'reminder' AND (c.status <> 'open'
                                  OR c.locks_at IS NULL
                                  OR c.locks_at <= now()))
     OR (n.kind = 'locked'   AND c.status NOT IN ('locked', 'evaluating', 'finished'))
     OR (n.kind = 'winner'   AND c.status <> 'finished')
   );
