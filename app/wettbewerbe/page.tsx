/** Competitions list (spec §27). */
import { query } from "@/lib/db.ts";
import { money, when } from "@/lib/templates.ts";
import { Shell, StatusBadge, requireAdmin } from "../shell.tsx";

export const dynamic = "force-dynamic";

const STATUS_ORDER = "CASE status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'locked' THEN 2 WHEN 'evaluating' THEN 3 ELSE 4 END";

export default async function CompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = params.status ?? "";

  const rows = await query<{
    id: number; name: string; type: string; status: string;
    prize_amount: number; currency: string;
    opens_at: Date | null; locks_at: Date | null; ends_at: Date | null;
    participants: number; matches: number;
  }>(
    `SELECT c.id, c.name, c.type, c.status, c.prize_amount, c.currency,
            c.opens_at, c.locks_at, c.ends_at,
            (SELECT COUNT(*)::int FROM participants p WHERE p.competition_id = c.id) AS participants,
            (SELECT COUNT(*)::int FROM competition_fixtures f WHERE f.competition_id = c.id) AS matches
       FROM competitions c
      WHERE ($1 = '' OR c.status = $1)
      ORDER BY ${STATUS_ORDER}, COALESCE(c.locks_at, c.created_at) DESC
      LIMIT 200`,
    [filter],
  );

  const filters: Array<[string, string]> = [
    ["", "Alle"],
    ["draft", "Entwurf"],
    ["open", "Geöffnet"],
    ["locked", "Gesperrt"],
    ["evaluating", "Auswertung"],
    ["finished", "Beendet"],
  ];

  return (
    <Shell
      title="Wettbewerbe"
      active="/wettbewerbe"
      actions={
        <a className="button" href="/wettbewerbe/neu">
          + NEUE COMPETITION
        </a>
      }
    >
      <div className="actions" style={{ marginBottom: 14 }}>
        {filters.map(([value, label]) => (
          <a
            key={value}
            className={`button small ${filter === value ? "" : "secondary"}`}
            href={value ? `/wettbewerbe?status=${value}` : "/wettbewerbe"}
          >
            {label}
          </a>
        ))}
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted">
            Noch kein Wettbewerb. <a href="/wettbewerbe/neu">Jetzt anlegen</a>.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wrap">Name</th>
                  <th>Typ</th>
                  <th>Status</th>
                  <th>Preisgeld</th>
                  <th>Spiele</th>
                  <th>Teilnehmer</th>
                  <th>Start</th>
                  <th>Tippschluss</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="wrap">
                      <a href={`/wettbewerbe/${c.id}`}>{c.name}</a>
                    </td>
                    <td className="muted">{c.type}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>{money(c.prize_amount, c.currency)}</td>
                    <td>{c.matches}</td>
                    <td>{c.participants}</td>
                    <td>{when(c.opens_at)}</td>
                    <td>{when(c.locks_at)}</td>
                    <td>
                      <div className="actions">
                        <a className="button secondary small" href={`/wettbewerbe/${c.id}`}>
                          Bearbeiten
                        </a>
                        <a
                          className="button secondary small"
                          href={`/leaderboards?wettbewerb=${c.id}`}
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
