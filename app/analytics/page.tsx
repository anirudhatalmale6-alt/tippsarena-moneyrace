/**
 * Analytics (spec §33).
 *
 * The funnel per campaign is the point of this page: he is buying ads, and he
 * needs to see how far each campaign's traffic actually gets. Every number here
 * is counted from the tables, never estimated.
 */
import { query } from "@/lib/db.ts";
import { Shell, requireAdmin } from "../shell.tsx";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireAdmin();

  const [totals] = await query<{
    users: number; users_7: number; users_30: number;
    active_7: number; entries: number; completed: number; channel_members: number;
  }>(
    `SELECT
      (SELECT COUNT(*)::int FROM users)                                        AS users,
      (SELECT COUNT(*)::int FROM users WHERE created_at > now() - interval '7 days')  AS users_7,
      (SELECT COUNT(*)::int FROM users WHERE created_at > now() - interval '30 days') AS users_30,
      (SELECT COUNT(*)::int FROM users WHERE last_seen_at > now() - interval '7 days') AS active_7,
      (SELECT COUNT(*)::int FROM participants)                                 AS entries,
      (SELECT COUNT(*)::int FROM participants WHERE completed)                 AS completed,
      (SELECT COUNT(*)::int FROM users WHERE channel_member)                   AS channel_members`,
  );

  /**
   * The funnel, per campaign code. "Bot starts" is what we can actually count -
   * an ad impression or a click happens at Meta, not here, so those two rows of
   * his example are not invented from something else.
   */
  const campaigns = await query<{
    code: string; starts: number; channel: number; entries: number; completed: number;
  }>(
    `SELECT cs.code,
            COUNT(DISTINCT u.id)::int AS starts,
            COUNT(DISTINCT u.id) FILTER (WHERE u.channel_member)::int AS channel,
            COUNT(DISTINCT pa.user_id)::int AS entries,
            COUNT(DISTINCT pa.user_id) FILTER (WHERE pa.completed)::int AS completed
       FROM campaign_sources cs
       LEFT JOIN users u ON u.campaign_source_id = cs.id
       LEFT JOIN participants pa ON pa.user_id = u.id
      GROUP BY cs.code
      ORDER BY starts DESC
      LIMIT 50`,
  );

  const byTypee = await query<{
    type: string; competitions: number; entries: number; prize: number;
  }>(
    `SELECT c.type, COUNT(DISTINCT c.id)::int AS competitions,
            COUNT(pa.id)::int AS entries,
            COALESCE(SUM(DISTINCT c.prize_amount), 0) AS prize
       FROM competitions c
       LEFT JOIN participants pa ON pa.competition_id = c.id
      GROUP BY c.type ORDER BY entries DESC`,
  );

  const daily = await query<{ day: string; n: number }>(
    `SELECT to_char(date_trunc('day', created_at), 'DD.MM') AS day, COUNT(*)::int AS n
       FROM users WHERE created_at > now() - interval '14 days'
      GROUP BY 1, date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at)`,
  );
  const peak = Math.max(1, ...daily.map((d) => d.n));

  const pct = (a: number, b: number) =>
    b === 0 ? "-" : `${Math.round((a / b) * 100)}%`;

  return (
    <Shell title="Analytics" active="/analytics">
      <div className="cards">
        <div className="card">
          <div className="label">Users total</div>
          <div className="value">{totals.users}</div>
        </div>
        <div className="card">
          <div className="label">New (7 days)</div>
          <div className="value">{totals.users_7}</div>
        </div>
        <div className="card">
          <div className="label">New (30 days)</div>
          <div className="value">{totals.users_30}</div>
        </div>
        <div className="card">
          <div className="label">Active (7 days)</div>
          <div className="value">{totals.active_7}</div>
        </div>
        <div className="card">
          <div className="label">Channel members</div>
          <div className="value">{totals.channel_members}</div>
          <div className="hint">last checked</div>
        </div>
        <div className="card">
          <div className="label">Entries</div>
          <div className="value">{totals.entries}</div>
          <div className="hint">
            {totals.completed} complete ({pct(totals.completed, totals.entries)})
          </div>
        </div>
      </div>

      <h2>New users, 14 days</h2>
      <div className="panel">
        {daily.length === 0 ? (
          <p className="muted">No users yet.</p>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 130 }}>
            {daily.map((d) => (
              <div key={d.day} style={{ flex: 1, textAlign: "center", minWidth: 22 }}>
                <div
                  title={`${d.n}`}
                  style={{
                    background: "var(--green)",
                    height: `${Math.round((d.n / peak) * 100)}px`,
                    borderRadius: "4px 4px 0 0",
                  }}
                />
                <div className="hint" style={{ fontSize: 10 }}>{d.day}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2>Campaigns</h2>
      <div className="panel">
        {campaigns.length === 0 ? (
          <p className="muted">
            No campaign yet. A link like{" "}
            <span className="mono">t.me/YourBot?start=meta_campaign_1</span>{" "}
            creates one automatically on the first click.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Startsed the bot</th>
                  <th>Joined channel</th>
                  <th>Entered</th>
                  <th>Predictions complete</th>
                  <th>Completion rate</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.code}>
                    <td className="mono">{c.code}</td>
                    <td>{c.starts}</td>
                    <td>
                      {c.channel} <span className="muted">({pct(c.channel, c.starts)})</span>
                    </td>
                    <td>
                      {c.entries} <span className="muted">({pct(c.entries, c.starts)})</span>
                    </td>
                    <td>{c.completed}</td>
                    <td>{pct(c.completed, c.entries)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          Clicks and impressions live at Meta and TikTok - this page counts only
          what actually arrives in the bot.
        </div>
      </div>

      <h2>By competition type</h2>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Competitions</th>
                <th>Entries</th>
              </tr>
            </thead>
            <tbody>
              {byTypee.map((t) => (
                <tr key={t.type}>
                  <td>{t.type}</td>
                  <td>{t.competitions}</td>
                  <td>{t.entries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
