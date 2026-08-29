/** Telegram: message templates and publishing (spec §30, §31, §32). */
import { query } from "@/lib/db.ts";
import { listTemplates } from "@/lib/templates.ts";
import { when } from "@/lib/templates.ts";
import { Notice, Shell, requireAdmin } from "../shell.tsx";
import { actionRetryNotification, actionSaveTemplate, actionSendTemplate } from "../actions.ts";

export const dynamic = "force-dynamic";

/** What each template may use. Shown next to the box, so he never has to guess. */
const PLACEHOLDERS: Record<string, string> = {
  channel_competition_new: "{name} {prize} {match_count} {winner_count} {lock_time}",
  channel_reminder: "{name} {prize} {hours} {lock_time}",
  channel_locked: "{name} {participants}",
  channel_results: "{name} {leaderboard}",
  channel_winner: "{name} {prize} {winner}",
  channel_giveaway: "{prize} {description}",
  competition_intro: "{name} {prize} {match_count} {lock_time}",
  predictions_saved: "{name} {done} {total} {prize}",
  membership_required: "{support}",
  already_entered: "{name} {prize} {lock_time}",
};

export default async function TelegramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const templates = await listTemplates();
  const selectedKey = params.template ?? templates[0]?.key ?? "";
  const selected = templates.find((t) => t.key === selectedKey) ?? templates[0];

  const competitions = await query<{ id: number; name: string }>(
    "SELECT id, name FROM competitions ORDER BY COALESCE(locks_at, created_at) DESC LIMIT 30",
  );

  const channel = await query<{ value: string | null }>(
    "SELECT value #>> '{}' AS value FROM settings WHERE key = 'channel_chat_id'",
  );
  const channelSet = Boolean(channel[0]?.value);

  const pending = await query<{
    id: number; kind: string; due_at: Date; attempts: number;
    last_error: string | null; competition: string;
  }>(
    `SELECT n.id, n.kind, n.due_at, n.attempts, n.last_error, c.name AS competition
       FROM notifications n JOIN competitions c ON c.id = n.competition_id
      WHERE n.sent_at IS NULL
      ORDER BY n.due_at LIMIT 30`,
  );

  const sent = await query<{
    id: number; sent_at: Date; status: string; body: string; error: string | null;
  }>(
    `SELECT id, sent_at, status, left(body, 120) AS body, error
       FROM telegram_messages ORDER BY sent_at DESC LIMIT 20`,
  );

  return (
    <Shell title="Telegram" active="/telegram">
      {params.saved ? <Notice>Template saved.</Notice> : null}
      {params.sent_ok ? <Notice>Sent to the channel.</Notice> : null}
      {params.retry ? <Notice>Will be tried again.</Notice> : null}
      {params.error ? <Notice kind="bad">{params.error}</Notice> : null}
      {!channelSet ? (
        <Notice kind="warn">
          No channel is set yet. Announcements wait until a channel ID is entered under{" "}
          <a href="/settings">Settings</a> — nothing is lost in the meantime.
        </Notice>
      ) : null}

      <h2>Message templates</h2>
      <div className="panel">
        <div className="actions" style={{ marginBottom: 12 }}>
          {templates.map((t) => (
            <a
              key={t.key}
              className={`button small ${t.key === selected?.key ? "" : "secondary"}`}
              href={`/telegram?template=${t.key}`}
            >
              {t.name}
            </a>
          ))}
        </div>

        {selected ? (
          <form action={actionSaveTemplate}>
            <input type="hidden" name="key" value={selected.key} />
            <label htmlFor="body">
              Text — <span className="mono">{selected.key}</span>
            </label>
            <textarea id="body" name="body" defaultValue={selected.body} />
            <div className="hint">
              HTML allowed: &lt;b&gt;bold&lt;/b&gt;, &lt;i&gt;italic&lt;/i&gt;,
              &lt;code&gt;. Placeholders:{" "}
              <span className="mono">{PLACEHOLDERS[selected.key] ?? "none"}</span>
              . An unknown placeholder is left visible instead of turning into nothing.
            </div>

            <label htmlFor="buttons">Buttons (JSON)</label>
            <textarea
              id="buttons"
              name="buttons"
              defaultValue={JSON.stringify(selected.buttons ?? [], null, 2)}
              style={{ minHeight: 90 }}
            />
            <div className="hint">
              <span className="mono">
                [{"{"}&quot;text&quot;:&quot;🏁 JETZT TEILNEHMEN&quot;,&quot;action&quot;:&quot;deeplink&quot;{"}"}]
              </span>{" "}
              — action: deeplink (opens the bot), channel (channel link), url (with its own &quot;url&quot;).
            </div>
            <button type="submit">SAVE TEMPLATE</button>
          </form>
        ) : null}
      </div>

      <h2>Publish now</h2>
      <form action={actionSendTemplate} className="panel">
        <div className="row">
          <div>
            <label htmlFor="key">Template</label>
            <select id="key" name="key" defaultValue={selected?.key ?? ""}>
              {templates
                .filter((t) => t.key.startsWith("channel_"))
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="competition_id">Competition</label>
            <select id="competition_id" name="competition_id" defaultValue="">
              <option value="">(none)</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" disabled={!channelSet}>
          📢 PUBLISH
        </button>
      </form>

      <h2>Queued announcements</h2>
      <div className="panel">
        {pending.length === 0 ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wrap">Competition</th>
                  <th>Kind</th>
                  <th>Due</th>
                  <th>Attempts</th>
                  <th className="wrap">Error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((n) => (
                  <tr key={n.id}>
                    <td className="wrap">{n.competition}</td>
                    <td>{n.kind}</td>
                    <td>{when(n.due_at)}</td>
                    <td>{n.attempts}</td>
                    <td className="wrap muted">{n.last_error ?? "-"}</td>
                    <td>
                      {n.attempts > 0 ? (
                        <form action={actionRetryNotification}>
                          <input type="hidden" name="notification_id" value={n.id} />
                          <button className="secondary small" type="submit">
                            Try again
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
      </div>

      <h2>Gesendet</h2>
      <div className="panel">
        {sent.length === 0 ? (
          <p className="muted">Nothing sent yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th className="wrap">Text</th>
                </tr>
              </thead>
              <tbody>
                {sent.map((m) => (
                  <tr key={m.id}>
                    <td>{when(m.sent_at)}</td>
                    <td>
                      <span className={`badge ${m.status === "sent" ? "green" : "red"}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="wrap muted">{m.error ?? m.body}</td>
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
