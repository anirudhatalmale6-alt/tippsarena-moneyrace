/**
 * Create a competition from the command line.
 *
 * This exists so a competition can be set up before the dashboard is finished,
 * and it uses exactly the same functions the dashboard buttons will - so
 * anything proven here is proven for both.
 *
 *   node scripts/create-competition.ts \
 *     --name "Bundesliga MoneyRace #1" \
 *     --league 78 --season 2026 --from 2026-08-29 --to 2026-08-30 \
 *     --prize 250 --lock "2026-08-29T13:25:00+02:00" --matches 8 [--publish]
 */
import { pool } from "../lib/db.ts";
import { log } from "../lib/log.ts";
import {
  createCompetition,
  importFixtures,
  publishCompetition,
  setCompetitionFixtures,
} from "../lib/admin.ts";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return process.argv[index + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const name = arg("name");
  const leagueId = Number(arg("league"));
  const season = Number(arg("season"));
  const from = arg("from");
  const to = arg("to", from);
  const prize = Number(arg("prize", "0"));
  const lock = new Date(arg("lock"));
  const wanted = Number(arg("matches", "10"));

  if (Number.isNaN(lock.getTime())) throw new Error("--lock is not a date");

  const imported = await importFixtures(leagueId, season, from, to);
  log.info(`imported ${imported.fetched} fixtures`);
  if (!imported.fetched) throw new Error("no fixtures came back - nothing to build on");

  // Earliest first, and never more than were actually returned. Asking for ten
  // and silently building a competition of eight would be worse than stopping.
  const ordered = imported.fixtures
    .sort((a, b) => a.row.kickoffAt.getTime() - b.row.kickoffAt.getTime())
    .slice(0, wanted);
  if (ordered.length < wanted) {
    log.warn(
      `asked for ${wanted} matches, only ${ordered.length} exist in that range`,
    );
  }

  // A match that kicks off before the lock could be predicted after it started.
  const tooLate = ordered.filter((f) => f.row.kickoffAt < lock);
  if (tooLate.length) {
    throw new Error(
      `${tooLate.length} match(es) kick off before the lock time - move the lock earlier`,
    );
  }

  const competitionId = await createCompetition({
    name,
    prizeAmount: prize,
    locksAt: lock,
    opensAt: new Date(),
    requiresMembership: false,
  });
  await setCompetitionFixtures(competitionId, ordered.map((f) => f.id));

  if (flag("publish")) {
    await publishCompetition(competitionId);
    log.info(`competition ${competitionId} published`);
  }

  log.info(`competition ${competitionId} "${name}" with ${ordered.length} matches`);
  for (const f of ordered) {
    log.info(`  ${f.row.kickoffAt.toISOString()}  ${f.row.homeTeam} - ${f.row.awayTeam}`);
  }
  await pool.end();
}

main().catch((err) => {
  log.error("could not create the competition", err);
  process.exit(1);
});
