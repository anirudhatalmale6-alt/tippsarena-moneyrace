/** Referrals (spec §20). */
import { query } from "@/lib/db.ts";
import { when } from "@/lib/templates.ts";
import { Shell, requireAdmin } from "../shell.tsx";

export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  await requireAdmin();

  const [totals] = await query<{
    total: number; qualified: number; referrers: number;
  }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE qualified)::int AS qualified,
            COUNT(DISTINCT referrer_id)::int AS referrers
       FROM referrals`,
  );

  const top = await query<{
    username: string | null; first_name: string | null; telegram_id: number;
    invited: number; participated: number;
  }>(
    `SELECT u.username, u.first_name, u.telegram_id,
            COUNT(r.id)::int AS invited,
            COUNT(*) FILTER (
              WHERE EXISTS (SELECT 1 FROM participants p WHERE p.user_id = r.referred_id)
            )::int AS participated
       FROM referrals r
       JOIN users u ON u.id = r.referrer_id
      GROUP BY u.id, u.username, u.first_name, u.telegram_id
      ORDER BY invited DESC
      LIMIT 50`,
  );

  const recent = await query<{
    created_at: Date; referrer: string | null; referred: string | null;
    referred_id: number;
  }>(
    `SELECT r.created_at, ru.username AS referrer, du.username AS referred,
            du.telegram_id AS referred_id
       FROM referrals r
       JOIN users ru ON ru.id = r.referrer_id
       JOIN users du ON du.id = r.referred_id
      ORDER BY r.created_at DESC
      LIMIT 50`,
  );

  return (
    <Shell title="Referrals" active="/referrals">
      <div className="cards">
        <div className="card">
          <div className="label">Einladungen gesamt</div>
          <div className="value">{totals.total}</div>
        </div>
        <div className="card">
          <div className="label">Werber</div>
          <div className="value">{totals.referrers}</div>
        </div>
        <div className="card">
          <div className="label">Qualifiziert</div>
          <div className="value">{totals.qualified}</div>
        </div>
      </div>

      <h2>Top-Werber</h2>
      <div className="panel">
        {top.length === 0 ? (
          <p className="muted">Noch keine Einladungen.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nutzer</th>
                  <th>Telegram-ID</th>
                  <th>Eingeladen</th>
                  <th>Davon aktiv</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.telegram_id}>
                    <td>{r.username ? `@${r.username}` : (r.first_name ?? "-")}</td>
                    <td className="mono">{r.telegram_id}</td>
                    <td>
                      <strong>{r.invited}</strong>
                    </td>
                    <td>{r.participated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2>Zuletzt</h2>
      <div className="panel">
        {recent.length === 0 ? (
          <p className="muted">Noch nichts.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Wann</th>
                  <th>Werber</th>
                  <th>Neuer Nutzer</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i}>
                    <td>{when(r.created_at)}</td>
                    <td>{r.referrer ? `@${r.referrer}` : "-"}</td>
                    <td>
                      {r.referred ? `@${r.referred}` : <span className="mono">{r.referred_id}</span>}
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
