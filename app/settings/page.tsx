/** Settings (spec §38, §43, §44) - and the rules text, which is not hard-coded. */
import { query } from "@/lib/db.ts";
import { when } from "@/lib/templates.ts";
import { Notice, Shell, requireAdmin } from "../shell.tsx";
import { actionLogout, actionSaveSettings } from "../actions.ts";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;

  const rows = await query<{ key: string; value: any; description: string | null }>(
    "SELECT key, value, description FROM settings ORDER BY key",
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const str = (key: string) => {
    const value = map.get(key);
    return value === null || value === undefined ? "" : String(value);
  };
  const numOf = (key: string, fallback: number) => {
    const value = map.get(key);
    return value === null || value === undefined ? fallback : Number(value);
  };

  const audits = await query<{ created_at: Date; summary: string; action: string }>(
    "SELECT created_at, summary, action FROM audit_logs ORDER BY created_at DESC LIMIT 30",
  );

  return (
    <Shell
      title="Settings"
      active="/settings"
      actions={
        <form action={actionLogout}>
          <button className="secondary small" type="submit">
            SIGN OUT ({admin.name ?? admin.email})
          </button>
        </form>
      }
    >
      {params.saved ? <Notice>Saved.</Notice> : null}

      <form action={actionSaveSettings}>
        <div className="panel">
          <strong>Brand</strong>
          <div className="row">
            <div>
              <label htmlFor="brand_name">Brand name</label>
              <input id="brand_name" name="brand_name" type="text" defaultValue={str("brand_name")} />
            </div>
            <div>
              <label htmlFor="competition_brand">Competition brand</label>
              <input
                id="competition_brand"
                name="competition_brand"
                type="text"
                defaultValue={str("competition_brand")}
              />
            </div>
          </div>
        </div>

        <div className="panel">
          <strong>Telegram</strong>
          <div className="row">
            <div>
              <label htmlFor="bot_username">Bot username (without @)</label>
              <input
                id="bot_username"
                name="bot_username"
                type="text"
                defaultValue={str("bot_username")}
              />
              <div className="hint">Every deep link is built from this.</div>
            </div>
            <div>
              <label htmlFor="channel_chat_id">Channel ID or @name</label>
              <input
                id="channel_chat_id"
                name="channel_chat_id"
                type="text"
                placeholder="-1001234567890 or @tippsarena"
                defaultValue={str("channel_chat_id")}
              />
              <div className="hint">
                The bot has to be an administrator in the channel - otherwise it can
                neither check membership nor post.
              </div>
            </div>
            <div>
              <label htmlFor="channel_invite_url">Channel invite link</label>
              <input
                id="channel_invite_url"
                name="channel_invite_url"
                type="text"
                placeholder="https://t.me/+..."
                defaultValue={str("channel_invite_url")}
              />
              <div className="hint">Used by the KANAL BEITRETEN button.</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <strong>Times and numbers</strong>
          <div className="row">
            <div>
              <label htmlFor="timezone">Timezone</label>
              <select id="timezone" name="timezone" defaultValue={str("timezone") || "Europe/Berlin"}>
                {["Europe/Berlin", "Europe/Skopje", "Europe/Vienna", "Europe/Zurich", "UTC"].map(
                  (tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ),
                )}
              </select>
              <div className="hint">
                Applies to everything shown, and to times typed in.
              </div>
            </div>
            <div>
              <label htmlFor="currency">Currency</label>
              <input id="currency" name="currency" type="text" defaultValue={str("currency")} />
            </div>
            <div>
              <label htmlFor="reminder_hours_before_lock">
                Reminder, hours before lock
              </label>
              <input
                id="reminder_hours_before_lock"
                name="reminder_hours_before_lock"
                type="number"
                min="0"
                step="1"
                defaultValue={numOf("reminder_hours_before_lock", 1)}
              />
            </div>
            <div>
              <label htmlFor="football_default_season">Season for the match import</label>
              <input
                id="football_default_season"
                name="football_default_season"
                type="number"
                defaultValue={numOf("football_default_season", 2026)}
              />
            </div>
          </div>
        </div>

        <div className="panel">
          <strong>Rules</strong>
          <div className="hint">
            This is the text behind 📜 REGELN in the bot. Deliberately not in the
            code, so the final legal wording can be put in without a developer.
          </div>
          <label htmlFor="rules_text">Rules text (HTML allowed)</label>
          <textarea id="rules_text" name="rules_text" defaultValue={str("rules_text")} />
        </div>

        <button type="submit">SAVE</button>
      </form>

      <h2>Audit log</h2>
      <div className="panel">
        <div className="hint" style={{ marginBottom: 8 }}>
          Every change is written down here.
        </div>
        {audits.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th className="wrap">What</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a, i) => (
                  <tr key={i}>
                    <td>{when(a.created_at)}</td>
                    <td className="mono muted">{a.action}</td>
                    <td className="wrap">{a.summary}</td>
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
