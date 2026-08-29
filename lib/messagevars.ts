/**
 * The placeholders every announcement about a competition can use.
 *
 * One implementation, because there are two callers - the worker sending a
 * scheduled announcement and the dashboard sending one by hand - and an
 * announcement that reads differently depending on which button produced it is
 * a bug nobody will think to look for.
 *
 * German plurals cannot be done with a placeholder and a number: "1 Spiele" is
 * wrong and no amount of {match_count} fixes it. So the counted things arrive
 * already worded - {matches} is "1 Spiel" or "5 Spiele" - and the bare numbers
 * stay available for anything he has already written by hand.
 */
import { getSetting, one, query } from "./db.ts";
import { leaderboard } from "./competitions.ts";
import { money, when } from "./templates.ts";

/** "1 Spiel" / "5 Spiele". */
export function plural(count: number, singular: string, plural_: string): string {
  return `${count} ${count === 1 ? singular : plural_}`;
}

/** The template key an announcement of this competition should use. */
export function announcementTemplate(type: string, kind = "opened"): string {
  if (kind !== "opened") {
    return {
      reminder: "channel_reminder",
      locked: "channel_locked",
      results: "channel_results",
      winner: "channel_winner",
    }[kind] ?? "channel_competition_new";
  }
  if (type === "giveaway") return "channel_giveaway";
  if (type === "exact_score") return "channel_exact_new";
  return "channel_competition_new";
}

export async function competitionVars(
  competitionId: number | null,
  extra: { winner?: string } = {},
): Promise<Record<string, string | number>> {
  const tz = (await getSetting<string>("timezone", "Europe/Berlin"))!;
  const support = (await getSetting<string>("support_handle", "@tippsarena"))!;
  const reminderHours = (await getSetting<number>("reminder_hours_before_lock", 1))!;

  if (!competitionId) {
    return { support, hours: reminderHours, name: "", prize: "", lock_time: "" };
  }

  const competition = await one<any>(
    "SELECT * FROM competitions WHERE id = $1",
    [competitionId],
  );
  if (!competition) throw new Error(`competition ${competitionId} is gone`);

  const counts = await one<{ matches: number; participants: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM competition_fixtures WHERE competition_id = $1) AS matches,
       (SELECT COUNT(*)::int FROM participants WHERE competition_id = $1) AS participants`,
    [competitionId],
  );
  const matches = counts?.matches ?? 0;
  const participants = counts?.participants ?? 0;

  // The match itself, for an exact-score round where there is only one and
  // naming it is the whole point of the announcement.
  const fixtures = await query<{ home_team: string; away_team: string }>(
    `SELECT f.home_team, f.away_team
       FROM competition_fixtures cf JOIN fixtures f ON f.id = cf.fixture_id
      WHERE cf.competition_id = $1 ORDER BY cf.position`,
    [competitionId],
  );
  const match = fixtures.length
    ? fixtures.map((f) => `${f.home_team} — ${f.away_team}`).join("\n⚽ ")
    : "";

  let board = "";
  const rows = await leaderboard(competitionId, 10);
  const medals = ["🥇", "🥈", "🥉"];
  board = rows
    .map((r, i) => {
      const who = r.username ? `@${r.username}` : (r.first_name ?? "?");
      return `${medals[i] ?? `${i + 1}️⃣`} ${who} — ${r.points} Punkte`;
    })
    .join("\n");

  return {
    name: competition.name,
    prize: money(competition.prize_amount, competition.currency),
    lock_time: when(competition.locks_at, tz),
    description: competition.description ?? "",
    match,
    // Worded, so the template never has to guess the plural.
    matches: plural(matches, "Spiel", "Spiele"),
    tips: plural(matches, "Tipp", "Tipps"),
    winners: plural(competition.winner_count, "Gewinner", "Gewinner"),
    participants_word: plural(participants, "Teilnehmer", "Teilnehmer"),
    // The bare numbers stay, for anything already written against them.
    match_count: matches,
    participants,
    winner_count: competition.winner_count,
    hours: reminderHours,
    support,
    leaderboard: board,
    winner: extra.winner ?? "",
  };
}
