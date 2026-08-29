/** Participants (spec §28), searchable by username, Telegram id or competition. */
import { query } from "@/lib/db.ts";
import { when } from "@/lib/templates.ts";
import { Shell, requireAdmin } from "../shell.tsx";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; wettbewerb?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const competitionId = params.wettbewerb ? Number(params.wettbewerb) : null;

  const rows = await query<{
    telegram_id: number; username: string | null;
    first_name: string | null; last_name: string | null;
    competition: string; competition_id: number;
    joined_at: Date; completed: boolean; points: number; rank: number | null;
    campaign: string | null; referrer: string | null;
  }>(
    `SELECT u.telegram_id, u.username, u.first_name, u.last_name,
            c.name AS competition, c.id AS competition_id,
            pa.joined_at, pa.completed, pa.points, pa.rank,
            cs.code AS campaign,
            ru.username AS referrer
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
       JOIN competitions c ON c.id = pa.competition_id
       LEFT JOIN campaign_sources cs ON cs.id = u.campaign_source_id
       LEFT JOIN users ru ON ru.id = u.referred_by
      WHERE ($1::bigint IS NULL OR pa.competition_id = $1::bigint)
        AND ($2 = '' OR u.username ILIKE '%' || $2 || '%'
                     OR u.first_name ILIKE '%' || $2 || '%'
                     OR u.telegram_id::text = $2)
      ORDER BY pa.joined_at DESC
      LIMIT 300`,
    [competitionId, search],
  );

  const competitions = await query<{ id: number; name: string }>(
    "SELECT id, name FROM competitions ORDER BY COALESCE(locks_at, created_at) DESC LIMIT 50",
  );

  return (
    <Shell title="Teilnehmer" active="/teilnehmer">
      <form className="panel" method="get">
        <div className="row">
          <div>
            <label htmlFor="q">Suche</label>
            <input
              id="q"
              name="q"
              type="text"
              defaultValue={search}
              placeholder="Benutzername, Name oder Telegram-ID"
            />
          </div>
          <div>
            <label htmlFor="wettbewerb">Wettbewerb</label>
            <select id="wettbewerb" name="wettbewerb" defaultValue={params.wettbewerb ?? ""}>
              <option value="">Alle</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit">SUCHEN</button>
      </form>

      <div className="panel">
        <p className="muted">{rows.length} Einträge</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Telegram-ID</th>
                <th>Benutzername</th>
                <th className="wrap">Name</th>
                <th className="wrap">Wettbewerb</th>
                <th>Beigetreten</th>
                <th>Vollständig</th>
                <th>Punkte</th>
                <th>Platz</th>
                <th>Quelle</th>
                <th>Eingeladen von</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.telegram_id}</td>
                  <td>{r.username ? `@${r.username}` : "-"}</td>
                  <td className="wrap">
                    {[r.first_name, r.last_name].filter(Boolean).join(" ") || "-"}
                  </td>
                  <td className="wrap">
                    <a href={`/wettbewerbe/${r.competition_id}`}>{r.competition}</a>
                  </td>
                  <td>{when(r.joined_at)}</td>
                  <td>{r.completed ? "✅" : "—"}</td>
                  <td>{r.points}</td>
                  <td>{r.rank ?? "-"}</td>
                  <td className="muted">{r.campaign ?? "-"}</td>
                  <td className="muted">{r.referrer ? `@${r.referrer}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
