/**
 * Winners and prizes (spec §29).
 *
 * The system never moves money. This is the list of what is owed and a button
 * to record that he has paid it.
 */
import { query } from "@/lib/db.ts";
import { money, when } from "@/lib/templates.ts";
import { Notice, Shell, requireAdmin } from "../shell.tsx";
import { actionMarkPaid } from "../actions.ts";

export const dynamic = "force-dynamic";

export default async function WinnersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; saved?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = params.status ?? "";

  const rows = await query<{
    prize_id: number; competition: string; competition_id: number;
    username: string | null; first_name: string | null; telegram_id: number | null;
    rank: number | null; amount: number; currency: string;
    status: string; created_at: Date; paid_at: Date | null; notes: string | null;
  }>(
    `SELECT p.id AS prize_id, c.name AS competition, c.id AS competition_id,
            u.username, u.first_name, u.telegram_id,
            p.rank, p.amount, p.currency, p.status, p.created_at, p.paid_at, p.notes
       FROM prizes p
       JOIN competitions c ON c.id = p.competition_id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE ($1 = '' OR p.status = $1)
      ORDER BY p.status = 'pending' DESC, p.created_at DESC
      LIMIT 200`,
    [filter],
  );

  const [totals] = await query<{ open_amount: number; open_count: number }>(
    `SELECT COALESCE(SUM(amount),0) AS open_amount, COUNT(*)::int AS open_count
       FROM prizes WHERE status = 'pending'`,
  );

  const badge = (status: string) =>
    status === "paid" ? "green" : status === "closed" ? "blue" : "amber";

  return (
    <Shell title="Winners" active="/winners">
      {params.saved ? <Notice>Brandd as paid.</Notice> : null}

      <div className="cards">
        <div className="card">
          <div className="label">Prize money owed</div>
          <div className="value">{money(totals.open_amount)}</div>
          <div className="hint">{totals.open_count} open</div>
        </div>
      </div>

      <div className="actions" style={{ margin: "16px 0" }}>
        {[["", "All"], ["pending", "Pending"], ["paid", "Paid"],
          ["closed", "Closed"]].map(([value, label]) => (
          <a
            key={value}
            className={`button small ${filter === value ? "" : "secondary"}`}
            href={value ? `/winners?status=${value}` : "/winners"}
          >
            {label}
          </a>
        ))}
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted">No winners yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wrap">Competition</th>
                  <th>Winner</th>
                  <th>Telegram-ID</th>
                  <th>Rank</th>
                  <th>Preis</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Paid on</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.prize_id}>
                    <td className="wrap">
                      <a href={`/competitions/${r.competition_id}`}>{r.competition}</a>
                    </td>
                    <td>{r.username ? `@${r.username}` : (r.first_name ?? "-")}</td>
                    <td className="mono">{r.telegram_id ?? "-"}</td>
                    <td>{r.rank ?? "-"}</td>
                    <td>{money(r.amount, r.currency)}</td>
                    <td>
                      <span className={`badge ${badge(r.status)}`}>{r.status}</span>
                    </td>
                    <td>{when(r.created_at)}</td>
                    <td>{r.paid_at ? when(r.paid_at) : "-"}</td>
                    <td>
                      {r.status === "pending" ? (
                        <form action={actionMarkPaid}>
                          <input type="hidden" name="prize_id" value={r.prize_id} />
                          <button className="small" type="submit">
                            Mark as paid
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          The system never pays anything out. This list only says what is owed.
        </div>
      </div>
    </Shell>
  );
}
