/**
 * Users, deep links and referrals.
 *
 * Spec §3 and §20. Two things arrive in the same /start payload - where an ad
 * sent them from, and who invited them - and both have to be recorded the FIRST
 * time only. A returning user must not have their original source rewritten by
 * whatever link they happened to click today, or the acquisition numbers in §33
 * measure the last click instead of the first.
 */
import { one, query } from "./db.ts";
import { log } from "./log.ts";

export interface User {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  is_blocked: boolean;
  campaign_source_id: number | null;
  start_payload: string | null;
  referred_by: number | null;
  channel_member: boolean | null;
  channel_checked_at: Date | null;
  created_at: Date;
}

export interface StartPayload {
  /** ad/campaign code, e.g. "meta_campaign_1" */
  campaign: string | null;
  /** the inviting user's telegram id, from ref_<id> */
  referrerTelegramId: number | null;
  raw: string | null;
}

/**
 * Read a /start payload.
 *
 * Two shapes are understood, and anything else is kept verbatim as a campaign
 * code so a new ad format never silently loses its attribution:
 *
 *   ref_12345          -> an invite from telegram user 12345
 *   meta_campaign_1    -> an ad campaign code
 */
export function parseStartPayload(raw: string | null | undefined): StartPayload {
  const text = (raw ?? "").trim();
  if (!text) return { campaign: null, referrerTelegramId: null, raw: null };

  if (/^ref_\d+$/i.test(text)) {
    return {
      campaign: null,
      referrerTelegramId: Number(text.slice(4)),
      raw: text,
    };
  }
  // Telegram allows A-Z a-z 0-9 _ - in a start parameter; anything else is not
  // something we sent, so it is dropped rather than stored.
  const safe = text.slice(0, 64).replace(/[^A-Za-z0-9_-]/g, "");
  return {
    campaign: safe || null,
    referrerTelegramId: null,
    raw: safe || null,
  };
}

async function campaignSourceId(code: string): Promise<number> {
  // Created on demand: a new ad campaign should need no admin work to be
  // tracked, it just has to appear in a link.
  const rows = await query<{ id: number }>(
    `INSERT INTO campaign_sources (code) VALUES ($1)
     ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
     RETURNING id`,
    [code],
  );
  return rows[0].id;
}

export interface TelegramUserish {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

/**
 * Find or create the user behind a Telegram update, applying a start payload
 * only if this is genuinely their first arrival.
 */
export async function upsertUser(
  from: TelegramUserish,
  payload: StartPayload = { campaign: null, referrerTelegramId: null, raw: null },
): Promise<{ user: User; isNew: boolean }> {
  const existing = await one<User>(
    "SELECT * FROM users WHERE telegram_id = $1",
    [from.id],
  );

  if (existing) {
    await query(
      `UPDATE users
          SET username = $2, first_name = $3, last_name = $4,
              language_code = COALESCE($5, language_code),
              last_seen_at = now()
        WHERE id = $1`,
      [
        existing.id,
        from.username ?? null,
        from.first_name ?? null,
        from.last_name ?? null,
        from.language_code ?? null,
      ],
    );
    return { user: existing, isNew: false };
  }

  const sourceId = payload.campaign ? await campaignSourceId(payload.campaign) : null;

  let referrerId: number | null = null;
  if (payload.referrerTelegramId && payload.referrerTelegramId !== from.id) {
    const referrer = await one<{ id: number }>(
      "SELECT id FROM users WHERE telegram_id = $1",
      [payload.referrerTelegramId],
    );
    referrerId = referrer?.id ?? null;
    if (!referrer) {
      log.warn(`referral from unknown telegram id ${payload.referrerTelegramId}`);
    }
  }

  const rows = await query<User>(
    `INSERT INTO users
       (telegram_id, username, first_name, last_name, language_code,
        campaign_source_id, start_payload, referred_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      from.id,
      from.username ?? null,
      from.first_name ?? null,
      from.last_name ?? null,
      from.language_code ?? null,
      sourceId,
      payload.raw,
      referrerId,
    ],
  );
  const user = rows[0];

  if (referrerId) {
    await query(
      `INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)
       ON CONFLICT (referred_id) DO NOTHING`,
      [referrerId, user.id],
    );
  }

  log.info(
    `new user ${user.telegram_id}` +
      (payload.campaign ? ` from campaign ${payload.campaign}` : "") +
      (referrerId ? ` invited by user ${referrerId}` : ""),
  );
  return { user, isNew: true };
}

export async function rememberMembership(
  userId: number,
  isMember: boolean,
): Promise<void> {
  await query(
    `UPDATE users SET channel_member = $2, channel_checked_at = now() WHERE id = $1`,
    [userId, isMember],
  );
}

export interface UserProfile {
  points: number;
  competitions: number;
  wins: number;
  top3: number;
  referrals: number;
}

/** The numbers behind "MEIN PROFIL" (spec §21), in one round trip. */
export async function profile(userId: number): Promise<UserProfile> {
  const row = await one<{
    points: string | number;
    competitions: string | number;
    wins: string | number;
    top3: string | number;
    referrals: string | number;
  }>(
    `SELECT
       COALESCE(SUM(pa.points), 0)                                  AS points,
       COUNT(pa.id)                                                 AS competitions,
       COUNT(*) FILTER (WHERE pa.rank = 1)                          AS wins,
       COUNT(*) FILTER (WHERE pa.rank IS NOT NULL AND pa.rank <= 3) AS top3,
       (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = $1)  AS referrals
     FROM participants pa
     JOIN competitions c ON c.id = pa.competition_id
    WHERE pa.user_id = $1
      AND c.status IN ('locked', 'evaluating', 'finished')`,
    [userId],
  );
  const n = (v: unknown) => Number(v ?? 0);
  return {
    points: n(row?.points),
    competitions: n(row?.competitions),
    wins: n(row?.wins),
    top3: n(row?.top3),
    referrals: n(row?.referrals),
  };
}

export interface ResultLine {
  competition_id: number;
  name: string;
  type: string;
  points: number;
  correct_count: number;
  total: number;
  rank: number | null;
  is_winner: boolean;
  /** Exact score only: what they tipped, what it finished, and whether it hit. */
  tip: string | null;
  final_score: string | null;
  match_name: string | null;
  is_exact: boolean | null;
  is_correct: boolean | null;
}

/** "MEINE ERGEBNISSE" (spec §22) - the races that are actually over. */
export async function recentResults(
  userId: number,
  limit = 10,
): Promise<ResultLine[]> {
  return query<ResultLine>(
    // GIVEAWAYS ARE EXCLUDED, and that is the point of his change: a giveaway
    // is a prize draw, not a scored competition. It has no points, no ranking
    // and nothing right or wrong, so every column below would be a zero
    // pretending to be a result. Entry and winning are told separately.
    `SELECT c.id AS competition_id, c.name, c.type, pa.points, pa.correct_count,
            pa.rank, pa.is_winner,
            (SELECT COUNT(*) FROM competition_fixtures cf
              WHERE cf.competition_id = c.id) AS total,
            -- The exact-score round has one match, so its tip, the real score
            -- and the verdict are all single values rather than a list.
            (SELECT pr.home_goals || ':' || pr.away_goals
               FROM predictions pr
              WHERE pr.participant_id = pa.id AND pr.home_goals IS NOT NULL
              ORDER BY pr.id LIMIT 1) AS tip,
            (SELECT CASE WHEN f.outcome IS NULL THEN NULL
                         ELSE f.home_goals || ':' || f.away_goals END
               FROM competition_fixtures cf JOIN fixtures f ON f.id = cf.fixture_id
              WHERE cf.competition_id = c.id ORDER BY cf.position LIMIT 1) AS final_score,
            (SELECT f.home_team || ' — ' || f.away_team
               FROM competition_fixtures cf JOIN fixtures f ON f.id = cf.fixture_id
              WHERE cf.competition_id = c.id ORDER BY cf.position LIMIT 1) AS match_name,
            (SELECT pr.is_exact FROM predictions pr
              WHERE pr.participant_id = pa.id ORDER BY pr.id LIMIT 1) AS is_exact,
            (SELECT pr.is_correct FROM predictions pr
              WHERE pr.participant_id = pa.id ORDER BY pr.id LIMIT 1) AS is_correct
       FROM participants pa
       JOIN competitions c ON c.id = pa.competition_id
      WHERE pa.user_id = $1
        AND c.type <> 'giveaway'
        AND c.status IN ('locked', 'evaluating', 'finished')
      ORDER BY COALESCE(c.locks_at, c.created_at) DESC
      LIMIT $2`,
    [userId, limit],
  );
}
