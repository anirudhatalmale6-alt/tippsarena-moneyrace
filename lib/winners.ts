/**
 * Who won, what the channel is allowed to say about it, and what the winner is
 * told privately.
 *
 * This file is the whole privacy model in one place, because the previous
 * version had it in no place: the worker rendered "{leaderboard}" - the top ten
 * by username - straight into a public channel the moment a competition
 * finished. With a hundred entrants that is a hundred people published.
 *
 * The rule now, from his correction:
 *
 *   PUBLIC CHANNEL   winner by @username, or the top 3, or nothing. Never more.
 *   PRIVATE BOT      a player sees their own results, and the full table if he
 *                    leaves that on.
 *   ADMIN            everything.
 *
 * Note what is NOT masked: the winner. He asked for that explicitly and it is
 * the point of a winner announcement. Somebody with no public username is
 * described rather than identified - never by first name, never by Telegram id.
 */
import { getSetting, one, query } from "./db.ts";
import { log } from "./log.ts";
import { audit } from "./admin.ts";
import { plural } from "./messagevars.ts";
import { money, render } from "./templates.ts";

export type PublicResultMode = "winner" | "top3" | "none";

export const RESULT_MODES: Array<[PublicResultMode, string]> = [
  ["winner", "The winner only (recommended)"],
  ["top3", "The top 3"],
  ["none", "Nothing — announce it by hand or not at all"],
];

export async function publicResultMode(): Promise<PublicResultMode> {
  const value = await getSetting<string>("public_result_mode", "winner");
  return (["winner", "top3", "none"].includes(value as string)
    ? value
    : "winner") as PublicResultMode;
}

/**
 * Who wins an Exact Score round when nobody got the scoreline.
 *
 * "best"       - the highest score wins, which under his own 3/1/0 table means
 *                somebody who only had the right result can take the prize.
 *                This is what has been happening.
 * "exact_only" - no exact hit, no winner. The round is announced as won by
 *                nobody and no prize is created.
 *
 * The default stays "best" because that is the behaviour his two live rounds
 * already ran under; changing it silently would rewrite a result he has seen.
 */
export type ExactPrizeRule = "best" | "exact_only";

export const EXACT_PRIZE_RULES: Array<[ExactPrizeRule, string]> = [
  ["best", "3 for the exact score, 1 for the right winner — the best tip wins"],
  ["exact_only", "3 for the exact score, 0 for anything else — no hit, no winner"],
];

export async function exactPrizeRule(): Promise<ExactPrizeRule> {
  const value = await getSetting<string>("exact_score_prize_rule", "best");
  return value === "exact_only" ? "exact_only" : "best";
}

export interface Placed {
  user_id: number;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  rank: number | null;
  points: number;
  correct_count: number;
  exact_hits: number;
  /** "2:1" for an exact-score round, null for a MoneyRace. */
  tip: string | null;
  /** Whether the scoreline was hit. Null when no scoreline was given at all. */
  is_exact: boolean | null;
}

/**
 * The finishing order. `limit` is a hard cap, not a suggestion - every caller
 * that publishes has to name how many people it is allowed to mention.
 */
export async function placings(competitionId: number, limit: number): Promise<Placed[]> {
  if (limit <= 0) return [];
  return query<Placed>(
    `SELECT u.id AS user_id, u.telegram_id, u.username, u.first_name,
            pa.rank, pa.points, pa.correct_count, pa.exact_hits,
            (SELECT pr.home_goals || ':' || pr.away_goals
               FROM predictions pr
              WHERE pr.participant_id = pa.id AND pr.home_goals IS NOT NULL
              ORDER BY pr.id LIMIT 1) AS tip,
            (SELECT pr.is_exact FROM predictions pr
              WHERE pr.participant_id = pa.id ORDER BY pr.id LIMIT 1) AS is_exact
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1 AND pa.is_winner = TRUE
      ORDER BY pa.rank NULLS LAST, pa.points DESC, pa.submitted_at NULLS LAST, pa.id
      LIMIT $2`,
    [competitionId, limit],
  );
}

/** The top N by score, winner flag or not - used for the podium. */
export async function topN(competitionId: number, limit: number): Promise<Placed[]> {
  if (limit <= 0) return [];
  return query<Placed>(
    `SELECT u.id AS user_id, u.telegram_id, u.username, u.first_name,
            pa.rank, pa.points, pa.correct_count, pa.exact_hits,
            (SELECT pr.home_goals || ':' || pr.away_goals
               FROM predictions pr
              WHERE pr.participant_id = pa.id AND pr.home_goals IS NOT NULL
              ORDER BY pr.id LIMIT 1) AS tip
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1
      ORDER BY pa.rank NULLS LAST, pa.points DESC, pa.submitted_at NULLS LAST, pa.id
      LIMIT $2`,
    [competitionId, limit],
  );
}

/**
 * How a person may be named in a public post.
 *
 * The winner keeps their @username - that is deliberate and he said so twice.
 * Somebody without one gets no substitute: not their first name (which is a
 * real name), not their Telegram id, not a masked initial.
 */
export function publicName(username: string | null): string | null {
  return username ? `@${username}` : null;
}

export interface PublicResult {
  /** null when nothing should be posted at all. */
  templateKey: string | null;
  vars: Record<string, string | number>;
  /** How many people the post names. Asserted by the tests. */
  named: number;
}

/**
 * Build the channel post for a finished competition, obeying the setting.
 *
 * Returns the template and its variables rather than sending, so the same
 * decision can be previewed in the dashboard and asserted in a test without
 * anything reaching Telegram.
 */
export async function publicResult(competitionId: number): Promise<PublicResult> {
  const competition = await one<any>(
    "SELECT * FROM competitions WHERE id = $1", [competitionId]);
  if (!competition) throw new Error("Competition not found");

  const mode = await publicResultMode();
  if (mode === "none") return { templateKey: null, vars: {}, named: 0 };

  const support = (await getSetting<string>("support_handle", "@thomastippsarena"))!;
  const prize = money(competition.prize_amount, competition.currency);

  // Nobody scored in an exact-score round is a result, and it has to be posted
  // as one whatever the podium setting says. Under his rule a wrong scoreline is
  // worth 0, so "top 3" here would print 🥇 @somebody — 0 Punkte: a podium built
  // out of people who all missed, which reads as a win to anyone scrolling past.
  const exactNoScorer = async (): Promise<PublicResult | null> => {
    if (competition.type !== "exact_score") return null;
    const best = await topN(competitionId, 1);
    if (best.length && best[0].points > 0) return null;
    const fx = await one<{ home_team: string; away_team: string;
      home_goals: number | null; away_goals: number | null }>(
      `SELECT f.home_team, f.away_team, f.home_goals, f.away_goals
         FROM competition_fixtures cf JOIN fixtures f ON f.id = cf.fixture_id
        WHERE cf.competition_id = $1 ORDER BY cf.position LIMIT 1`,
      [competitionId],
    );
    return {
      templateKey: "channel_exact_no_winner",
      vars: {
        name: competition.name,
        match: fx ? `${fx.home_team} — ${fx.away_team}` : "",
        final_score:
          fx && fx.home_goals !== null ? `${fx.home_goals}:${fx.away_goals}` : "-",
        prize,
        support,
      },
      named: 0,
    };
  };

  if (mode === "top3") {
    const nobody = await exactNoScorer();
    if (nobody) return nobody;
    const rows = await topN(competitionId, 3);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows
      .map((r, i) => {
        const name = publicName(r.username);
        // Somebody in the top three with no public username is shown as a
        // placing, not as a person. Skipping the row would misnumber the
        // podium; naming them any other way would be the leak this fixes.
        return `${medals[i]} ${name ?? "Teilnehmer ohne öffentlichen Namen"} — ${plural(r.points, "Punkt", "Punkte")}`;
      })
      .join("\n");
    return {
      templateKey: "channel_top3",
      vars: { name: competition.name, podium: lines, support, prize },
      named: rows.filter((r) => r.username).length,
    };
  }

  // ---- winner only
  const [winner] = await placings(competitionId, 1);
  if (!winner) {
    // An exact-score round with nobody left standing is a result in itself and
    // has to be said out loud, or the channel just goes quiet after a
    // competition it announced.
    if (competition.type === "exact_score") {
      const nobody = await exactNoScorer();
      if (nobody) return nobody;
    }
    return { templateKey: null, vars: {}, named: 0 };
  }

  const name = publicName(winner.username);
  if (!name) {
    return {
      templateKey: "channel_winner_anonymous",
      vars: { name: competition.name, support },
      named: 0,
    };
  }

  const fixture = await one<{ home_team: string; away_team: string;
    home_goals: number | null; away_goals: number | null }>(
    `SELECT f.home_team, f.away_team, f.home_goals, f.away_goals
       FROM competition_fixtures cf JOIN fixtures f ON f.id = cf.fixture_id
      WHERE cf.competition_id = $1 ORDER BY cf.position LIMIT 1`,
    [competitionId],
  );

  const shared = {
    name: competition.name,
    winner: name,
    winner_points: plural(winner.points, "Punkt", "Punkte"),
    prize,
    support,
    rank: winner.rank ?? 1,
  };

  if (competition.type === "exact_score") {
    // What is said about the win is read from the prediction, never assumed.
    //
    // He read the old post as the bot claiming a 3:1 tip had won a match that
    // finished 2:0 - "not possible". The scoring was right (right result, wrong
    // scoreline, 1 point of a possible 3) but the post did not say so: the
    // headline was EXACT SCORE - GEWINNER, and the tip was printed above the
    // result, so the eye read the tip as the score. Three changes, all wording:
    //
    //   * the final score comes FIRST and is labelled "Endstand"
    //   * the verdict says outright when nobody hit the exact score
    //   * the tip is labelled as the winner's tip, with what it paid
    const finalScore =
      fixture && fixture.home_goals !== null
        ? `${fixture.home_goals}:${fixture.away_goals}`
        : null;
    const verdict = winner.is_exact
      ? "🎯 <b>EXAKT RICHTIG!</b>"
      : "❌ Das exakte Ergebnis hatte niemand — es gewinnt der beste Tipp.";
    return {
      templateKey: "channel_exact_winner",
      vars: {
        ...shared,
        match: fixture ? `${fixture.home_team} — ${fixture.away_team}` : "",
        final_score: finalScore ?? "-",
        winner_tip: winner.tip ?? "-",
        // Never empty, so the layout cannot collapse into a blank line: with no
        // scoreline stored at all it falls back to what was actually scored.
        winner_line: winner.tip
          ? `🎯 Tipp: <b>${winner.tip}</b> — ${plural(winner.points, "Punkt", "Punkte")}`
          : `📌 ${plural(winner.points, "Punkt", "Punkte")}`,
        verdict,
      },
      named: 1,
    };
  }
  return { templateKey: "channel_winner_only", vars: shared, named: 1 };
}

/**
 * Tell the winner privately. Mandatory for every type (his §6) and independent
 * of whatever the channel does or does not say.
 */
export async function notifyCompetitionWinners(
  competitionId: number,
  adminUserId: number | null = null,
): Promise<{ sent: number; failed: number }> {
  const competition = await one<any>(
    "SELECT * FROM competitions WHERE id = $1", [competitionId]);
  if (!competition) throw new Error("Competition not found");

  const winners = await placings(competitionId, 20);
  if (!winners.length) return { sent: 0, failed: 0 };

  const support = (await getSetting<string>("support_handle", "@thomastippsarena"))!;
  const fixture = await one<{ home_team: string; away_team: string;
    home_goals: number | null; away_goals: number | null }>(
    `SELECT f.home_team, f.away_team, f.home_goals, f.away_goals
       FROM competition_fixtures cf JOIN fixtures f ON f.id = cf.fixture_id
      WHERE cf.competition_id = $1 ORDER BY cf.position LIMIT 1`,
    [competitionId],
  );
  const { sendToUser } = await import("../worker/announce.ts");

  let sent = 0;
  let failed = 0;
  for (const winner of winners) {
    const message = await render(
      competition.type === "exact_score" ? "winner_dm_exact" : "winner_dm_moneyrace",
      {
        name: competition.name,
        rank: winner.rank ?? 1,
        winner_points: plural(winner.points, "Punkt", "Punkte"),
        prize: money(competition.prize_amount, competition.currency),
        support,
        match: fixture ? `${fixture.home_team} — ${fixture.away_team}` : "",
        winner_tip: winner.tip ?? "-",
        winner_line: winner.tip ? `🎯 Dein Tipp: <b>${winner.tip}</b>` : "",
        final_score:
          fixture && fixture.home_goals !== null
            ? `${fixture.home_goals}:${fixture.away_goals}`
            : "-",
      },
    );
    const ok = await sendToUser(Number(winner.telegram_id), message, competitionId);
    if (ok) sent += 1;
    else failed += 1;

    await query(
      `UPDATE prizes
          SET notified_at  = CASE WHEN $3 THEN now() ELSE notified_at END,
              notify_error = CASE WHEN $3 THEN NULL
                             ELSE 'Telegram refused the message - the winner has probably never started the bot, or has blocked it.' END
        WHERE competition_id = $1 AND user_id = $2`,
      [competitionId, winner.user_id, ok],
    );
  }

  await audit(adminUserId, "competition.notify_winners",
    `${sent} winner(s) told privately, ${failed} could not be reached`,
    "competition", competitionId);
  log.info(`competition ${competitionId}: ${sent} winner DMs sent, ${failed} failed`);
  return { sent, failed };
}

// ---------------------------------------------------------------- rankings
//
// The all-time tables moved to lib/leaderboard.ts on 29 Aug, and the function
// that used to live here - "give me the top fifteen, named" - was deleted
// rather than left unused. He asked that no screen show the field, and a
// function that returns the field is a screen waiting to be written.
