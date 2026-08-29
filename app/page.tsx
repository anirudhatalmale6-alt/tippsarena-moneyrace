/** Dashboard home (spec §26). */
import { query } from "@/lib/db.ts";
import { money, when } from "@/lib/templates.ts";
import { Notice, Shell, StatusBadge, requireAdmin } from "./shell.tsx";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireAdmin();

  const [stats] = await query<{
    active: number;
    participants_today: number;
    participants_week: number;
    new_users_week: number;
    finished: number;
    pending_prizes: number;
    pending_amount: number;
    referred_users: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM competitions WHERE status = 'open')          AS active,
      (SELECT COUNT(*)::int FROM participants WHERE joined_at::date = CURRENT_DATE) AS participants_today,
      (SELECT COUNT(*)::int FROM participants WHERE joined_at > now() - interval '7 days') AS participants_week,
      (SELECT COUNT(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_users_week,
      (SELECT COUNT(*)::int FROM competitions WHERE status = 'finished')      AS finished,
      (SELECT COUNT(*)::int FROM prizes WHERE status = 'pending')          AS pending_prizes,
      (SELECT COALESCE(SUM(amount),0) FROM prizes WHERE status = 'pending') AS pending_amount,
      (SELECT COUNT(*)::int FROM users WHERE referred_by IS NOT NULL)         AS referred_users
  `);

  const running = await query<{
    id: number; name: string; status: string; prize_amount: number;
    currency: string; locks_at: Date | null; participants: number;
  }>(`
    SELECT c.id, c.name, c.status, c.prize_amount, c.currency, c.locks_at,
           (SELECT COUNT(*)::int FROM participants p WHERE p.competition_id = c.id) AS participants
      FROM competitions c
     WHERE c.status IN ('draft','open','locked','evaluating')
     ORDER BY c.locks_at NULLS LAST
     LIMIT 10
  `);

  // Anything the operator has to act on, gathered in one place so he does not
  // have to go looking: a stalled evaluation or an announcement that failed.
  const stuck = await query<{ id: number; name: string; evaluation_note: string }>(
    `SELECT id, name, evaluation_note FROM competitions
      WHERE evaluation_note IS NOT NULL AND status IN ('locked','evaluating')`,
  );
  const failedMessages = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE sent_at IS NULL AND (attempts >= 5 OR last_error IS NOT NULL)`,
  );
  const recent = await query<{ created_at: Date; summary: string }>(
    "SELECT created_at, summary FROM audit_logs ORDER BY created_at DESC LIMIT 8",
  );

  return (
    <Shell title="Dashboard" active="/">
      {stuck.length ? (
        <Notice kind="warn">
          <strong>⚠️ Evaluation pending</strong>
          {stuck.map((c) => (
            <div key={c.id}>
              <a href={`/competitions/${c.id}`}>{c.name}</a> — {c.evaluation_note}
            </div>
          ))}
        </Notice>
      ) : null}

      {failedMessages[0]?.n ? (
        <Notice kind="bad">
          {failedMessages[0].n} Telegram message(s) could not be sent. <a href="/telegram">View</a>
        </Notice>
      ) : null}

      <div className="cards">
        <div className="card">
          <div className="label">Active competitions</div>
          <div className="value">{stats.active}</div>
        </div>
        <div className="card">
          <div className="label">Participants today</div>
          <div className="value">{stats.participants_today}</div>
        </div>
        <div className="card">
          <div className="label">Participants (7 days)</div>
          <div className="value">{stats.participants_week}</div>
        </div>
        <div className="card">
          <div className="label">New users (7 days)</div>
          <div className="value">{stats.new_users_week}</div>
        </div>
        <div className="card">
          <div className="label">Finished</div>
          <div className="value">{stats.finished}</div>
        </div>
        <div className="card">
          <div className="label">Prize money owed</div>
          <div className="value">{money(stats.pending_amount)}</div>
          <div className="hint">{stats.pending_prizes} open</div>
        </div>
        <div className="card">
          <div className="label">Came via invite</div>
          <div className="value">{stats.referred_users}</div>
        </div>
      </div>

      <h2>Running now</h2>
      <div className="panel">
        {running.length === 0 ? (
          <p className="muted">
            No competition running.{" "}
            <a href="/competitions/new">Create one now</a>.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wrap">Name</th>
                  <th>Status</th>
                  <th>Prize money</th>
                  <th>Participants</th>
                  <th>Lock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {running.map((c) => (
                  <tr key={c.id}>
                    <td className="wrap">{c.name}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>{money(c.prize_amount, c.currency)}</td>
                    <td>{c.participants}</td>
                    <td>{when(c.locks_at)}</td>
                    <td>
                      <a className="button secondary small" href={`/competitions/${c.id}`}>
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2>Recent activity</h2>
      <div className="panel">
        {recent.length === 0 ? (
          <p className="muted">Nothing has happened yet.</p>
        ) : (
          recent.map((row, i) => (
            <div key={i} style={{ padding: "5px 0" }}>
              <span className="muted mono">{when(row.created_at)}</span> {row.summary}
            </div>
          ))
        )}
      </div>
    </Shell>
  );
}
