/** Competitions list (spec §27). */
import { query } from "@/lib/db.ts";
import { visibility } from "@/lib/admin.ts";
import { money, whenAdmin } from "@/lib/templates.ts";
import { Notice, Shell, StatusBadge, requireAdmin } from "../shell.tsx";

export const dynamic = "force-dynamic";

const STATUS_ORDER = "CASE status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'locked' THEN 2 WHEN 'evaluating' THEN 3 ELSE 4 END";

export default async function CompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; deleted?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = params.status ?? "";

  const rows = await query<{
    id: number; name: string; type: string; status: string;
    prize_amount: number; currency: string;
    opens_at: Date | null; locks_at: Date | null; ends_at: Date | null;
    published_at: Date | null;
    participants: number; matches: number;
  }>(
    `SELECT c.id, c.name, c.type, c.status, c.prize_amount, c.currency,
            c.opens_at, c.locks_at, c.ends_at, c.published_at,
            (SELECT COUNT(*)::int FROM participants p WHERE p.competition_id = c.id) AS participants,
            (SELECT COUNT(*)::int FROM competition_fixtures f WHERE f.competition_id = c.id) AS matches
       FROM competitions c
      WHERE ($1 = '' OR c.status = $1)
      ORDER BY ${STATUS_ORDER}, COALESCE(c.locks_at, c.created_at) DESC
      LIMIT 200`,
    [filter],
  );

  const filters: Array<[string, string]> = [
    ["", "All"],
    ["draft", "Draft"],
    ["open", "Open"],
    ["locked", "Locked"],
    ["evaluating", "Evaluating"],
    ["finished", "Finished"],
  ];

  return (
    <Shell
      title="Competitions"
      active="/competitions"
      actions={
        <a className="button" href="/competitions/new">
          + NEW COMPETITION
        </a>
      }
    >
      {params.deleted ? (
        <Notice>The competition and everything belonging to it are gone.</Notice>
      ) : null}

      <div className="actions" style={{ marginBottom: 14 }}>
        {filters.map(([value, label]) => (
          <a
            key={value}
            className={`button small ${filter === value ? "" : "secondary"}`}
            href={value ? `/competitions?status=${value}` : "/competitions"}
          >
            {label}
          </a>
        ))}
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted">
            No competition yet. <a href="/competitions/new">Create one</a>.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wrap">Name</th>
                  <th>Type</th>
                  <th>In the bot?</th>
                  <th>Status</th>
                  <th>Prize money</th>
                  <th>Matches</th>
                  <th>Participants</th>
                  <th>Starts</th>
                  <th>Lock</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="wrap">
                      <a href={`/competitions/${c.id}`}>{c.name}</a>
                    </td>
                    <td className="muted">{c.type}</td>
                    <td>
                      {(() => {
                        // Plain words, because "draft" did not tell him that
                        // players cannot see it - and that is the one thing this
                        // table has to answer at a glance. The label only: the
                        // full sentence wrapped this column into six lines and
                        // made every row four times as tall. It is on the
                        // competition's own page, one click away.
                        const seen = visibility(c);
                        return (
                          <span
                            style={{
                              color: seen.visible ? "var(--green)" : "var(--amber)",
                              whiteSpace: "nowrap",
                            }}
                            title={seen.detail}
                          >
                            {seen.visible ? "🟢" : "⚪"} {seen.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>{money(c.prize_amount, c.currency)}</td>
                    <td>{c.matches}</td>
                    <td>{c.participants}</td>
                    <td>{whenAdmin(c.opens_at)}</td>
                    <td>{whenAdmin(c.locks_at)}</td>
                    <td>
                      <div className="actions">
                        <a className="button secondary small" href={`/competitions/${c.id}`}>
                          Edit
                        </a>
                        <a
                          className="button secondary small"
                          href={`/leaderboards?competition=${c.id}`}
                        >
                          Leaderboard
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
