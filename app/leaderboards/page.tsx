/** Leaderboards (spec §23, §24): per competition, monthly and all-time. */
import { query } from "@/lib/db.ts";
import { Shell, requireAdmin } from "../shell.tsx";

export const dynamic = "force-dynamic";

type Row = {
  rank: number | null;
  username: string | null;
  first_name: string | null;
  points: number;
  correct_count?: number;
  exact_hits?: number;
  competitions?: number;
};

function Board({ title, rows }: { title: string; rows: Row[] }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <>
      <h2>{title}</h2>
      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted">No data yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>User</th>
                  <th>Points</th>
                  {rows[0].correct_count !== undefined ? <th>Correct</th> : null}
                  {rows[0].exact_hits !== undefined ? <th>Exact</th> : null}
                  {rows[0].competitions !== undefined ? <th>Entries</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{medals[i] ?? (r.rank ?? i + 1)}</td>
                    <td>{r.username ? `@${r.username}` : (r.first_name ?? "-")}</td>
                    <td>
                      <strong>{r.points}</strong>
                    </td>
                    {r.correct_count !== undefined ? <td>{r.correct_count}</td> : null}
                    {r.exact_hits !== undefined ? <td>{r.exact_hits}</td> : null}
                    {r.competitions !== undefined ? <td>{r.competitions}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ competition?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const competitions = await query<{ id: number; name: string; status: string }>(
    `SELECT id, name, status FROM competitions
      WHERE status IN ('open','locked','evaluating','finished')
      ORDER BY COALESCE(locks_at, created_at) DESC LIMIT 50`,
  );
  const selected = params.competition
    ? Number(params.competition)
    : (competitions[0]?.id ?? null);

  const single = selected
    ? await query<Row>(
        `SELECT pa.rank, u.username, u.first_name, pa.points,
                pa.correct_count, pa.exact_hits
           FROM participants pa JOIN users u ON u.id = pa.user_id
          WHERE pa.competition_id = $1
          ORDER BY pa.rank NULLS LAST, pa.points DESC, pa.id
          LIMIT 50`,
        [selected],
      )
    : [];

  // Only competitions that are actually decided contribute to the standings -
  // an open race would let a half-scored total climb the monthly table.
  const monthly = await query<Row>(
    `SELECT NULL::int AS rank, u.username, u.first_name,
            SUM(pa.points)::int AS points, COUNT(*)::int AS competitions
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
       JOIN competitions c ON c.id = pa.competition_id
      WHERE c.status = 'finished'
        AND date_trunc('month', COALESCE(c.locks_at, c.created_at))
            = date_trunc('month', now())
      GROUP BY u.id, u.username, u.first_name
      ORDER BY points DESC
      LIMIT 25`,
  );

  const allTime = await query<Row>(
    `SELECT NULL::int AS rank, u.username, u.first_name,
            SUM(pa.points)::int AS points, COUNT(*)::int AS competitions
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
       JOIN competitions c ON c.id = pa.competition_id
      WHERE c.status = 'finished'
      GROUP BY u.id, u.username, u.first_name
      ORDER BY points DESC
      LIMIT 25`,
  );

  return (
    <Shell title="Leaderboards" active="/leaderboards">
      <form className="panel" method="get">
        <label htmlFor="competition">Competition</label>
        <select
          id="competition"
          name="competition"
          defaultValue={selected ? String(selected) : ""}
        >
          {competitions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit">SHOW</button>
      </form>

      <Board
        title={
          competitions.find((c) => c.id === selected)?.name ?? "Competition"
        }
        rows={single}
      />
      <Board title="🏆 Monthly standings (this month)" rows={monthly} />
      <Board title="🏅 All-time standings" rows={allTime} />
    </Shell>
  );
}
