"use server";
/**
 * Every button in the dashboard that changes something.
 *
 * They all go through lib/admin.ts, which is the same code the command-line
 * scripts use - so a competition created from a phone and one created from a
 * script cannot behave differently. Each one re-checks the session, because a
 * server action is a public endpoint, not a page.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { findAdmin, readSessionToken, SESSION_COOKIE } from "@/lib/auth.ts";
import { query, setSetting } from "@/lib/db.ts";
import {
  audit,
  createCompetition,
  deleteCompetition,
  drawGiveaway,
  duplicateCompetition,
  importFixtures,
  markPrizePaid,
  publishCompetition,
  setCompetitionFixtures,
} from "@/lib/admin.ts";
import { queueBroadcast, type Audience } from "@/lib/broadcast.ts";
import {
  announceGiveawayWinner,
  createGiveawayPrize,
  notifyGiveawayWinner,
} from "@/lib/giveaway.ts";
import { setManualResult, clearManualResult, kickoffInFuture } from "@/lib/fixtures.ts";
import { evaluateCompetition } from "@/lib/competitions.ts";
import { saveTemplate, zonedToUtc } from "@/lib/templates.ts";
import { log } from "@/lib/log.ts";

/** The signed-in admin, or a redirect. Called by every action below. */
async function admin(): Promise<number> {
  const jar = await cookies();
  const id = await readSessionToken(jar.get(SESSION_COOKIE)?.value);
  const user = id ? await findAdmin(id) : null;
  if (!user) redirect("/login");
  return user.id;
}

const text = (form: FormData, key: string): string =>
  String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string, fallback = 0): number => {
  const raw = text(form, key);
  const value = Number(raw.replace(",", "."));
  return raw !== "" && Number.isFinite(value) ? value : fallback;
};
/**
 * A datetime-local field has no timezone. "15:25" means 15:25 where HE is, and
 * reading it as UTC would move every lock by two hours in summer - the
 * difference between locking before kick-off and locking after it.
 */
const localDate = (form: FormData, key: string, tz: string): Date | null =>
  zonedToUtc(text(form, key), tz);

async function timezone(): Promise<string> {
  const row = await query<{ tz: string }>(
    "SELECT value #>> '{}' AS tz FROM settings WHERE key = 'timezone'",
  );
  return row[0]?.tz || "Europe/Berlin";
}

// ---------------------------------------------------------------- competitions
export async function actionCreateCompetition(form: FormData): Promise<void> {
  const adminId = await admin();
  const tz = await timezone();

  const id = await createCompetition(
    {
      name: text(form, "name") || "New competition",
      type: text(form, "type") || "moneyrace",
      description: text(form, "description") || null,
      prizeAmount: num(form, "prize_amount"),
      currency: text(form, "currency") || "EUR",
      winnerCount: Math.max(1, num(form, "winner_count", 1)),
      requiresMembership: form.get("requires_membership") === "on",
      opensAt: localDate(form, "opens_at", tz),
      locksAt: localDate(form, "locks_at", tz),
      endsAt: localDate(form, "ends_at", tz),
      scoring: {
        correct_outcome: num(form, "points_correct", 1),
        exact_score: num(form, "points_exact", 0),
      },
      templateId: num(form, "template_id") || null,
      jackpotIncrement: num(form, "jackpot_increment") || null,
    },
    adminId,
  );

  const fixtureIds = form
    .getAll("fixture")
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (fixtureIds.length) await setCompetitionFixtures(id, fixtureIds, adminId);

  revalidatePath("/competitions");
  redirect(`/competitions/${id}?created=1`);
}

export async function actionUpdateCompetition(form: FormData): Promise<void> {
  const adminId = await admin();
  const tz = await timezone();
  const id = num(form, "id");

  const before = await query("SELECT * FROM competitions WHERE id = $1", [id]);
  await query(
    `UPDATE competitions
        SET name = $2, description = $3, prize_amount = $4, currency = $5,
            winner_count = $6, requires_membership = $7,
            opens_at = $8, locks_at = $9, ends_at = $10,
            -- A giveaway's form has no points boxes at all, so writing zeros
            -- from the missing fields would quietly wipe a scoring config if
            -- the type were ever changed back.
            scoring = CASE WHEN type = 'giveaway' THEN scoring
                      ELSE jsonb_build_object('correct_outcome', $11::numeric,
                                              'exact_score', $12::numeric) END,
            announce_winner_publicly = $13,
            updated_at = now()
      WHERE id = $1`,
    [
      id,
      text(form, "name"),
      text(form, "description") || null,
      num(form, "prize_amount"),
      text(form, "currency") || "EUR",
      Math.max(1, num(form, "winner_count", 1)),
      form.get("requires_membership") === "on",
      localDate(form, "opens_at", tz),
      localDate(form, "locks_at", tz),
      localDate(form, "ends_at", tz),
      num(form, "points_correct", 1),
      num(form, "points_exact", 0),
      // Only a giveaway's form carries this checkbox. For every other type the
      // stored value is left where it was rather than turned off by absence.
      before[0]?.type === "giveaway"
        ? form.get("announce_winner_publicly") === "on"
        : (before[0]?.announce_winner_publicly ?? true),
    ],
  );
  await audit(adminId, "competition.update", `Competition #${id} changed`,
    "competition", id, before[0]);
  revalidatePath(`/competitions/${id}`);
  redirect(`/competitions/${id}?saved=1`);
}

export async function actionSetFixtures(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  const fixtureIds = form
    .getAll("fixture")
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  try {
    await setCompetitionFixtures(id, fixtureIds, adminId);
  } catch (err) {
    redirect(`/competitions/${id}?error=${encodeURIComponent(String(err))}`);
  }
  redirect(`/competitions/${id}?saved=1`);
}

export async function actionPublish(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  try {
    await publishCompetition(id, adminId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/competitions/${id}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/competitions");
  redirect(`/competitions/${id}?published=1`);
}

export async function actionDuplicate(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  const name = text(form, "name") || `Copy of #${id}`;
  const newId = await duplicateCompetition(id, name, adminId);
  redirect(`/competitions/${newId}?created=1`);
}

/**
 * Delete a competition.
 *
 * Two steps on purpose: the first press shows what would be destroyed, the
 * second does it. `confirm` is the id itself rather than a flag, so a stale
 * form from another competition cannot delete this one.
 */
export async function actionDeleteCompetition(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");

  if (text(form, "confirm") !== String(id)) {
    redirect(`/competitions/${id}?confirm_delete=1`);
  }
  try {
    await deleteCompetition(id, adminId);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/competitions/${id}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/competitions");
  redirect("/competitions?deleted=1");
}

export async function actionSetStatus(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  const status = text(form, "status");
  if (!["draft", "open", "locked", "evaluating", "finished", "cancelled"].includes(status)) {
    redirect(`/competitions/${id}?error=Unknown+status`);
  }
  await query("UPDATE competitions SET status = $2, updated_at = now() WHERE id = $1",
    [id, status]);
  await audit(adminId, "competition.status", `Status set to "${status}"`,
    "competition", id);
  redirect(`/competitions/${id}?saved=1`);
}

export async function actionEvaluate(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  const outcome = await evaluateCompetition(id);
  await audit(adminId, "competition.evaluate",
    `Re-evaluated: ${outcome.scored} predictions, ${outcome.missingResults} without a result`,
    "competition", id);
  redirect(`/competitions/${id}?evaluated=${outcome.missingResults}`);
}

// ---------------------------------------------------------------- fixtures
export async function actionImportFixtures(form: FormData): Promise<void> {
  const adminId = await admin();
  // The dropdown carries ids confirmed against the API; the free box lets him
  // reach any other league without waiting for me to add it.
  const league = num(form, "league_custom") || num(form, "league");
  const season = num(form, "season", new Date().getFullYear());
  if (!league) redirect("/matches?error=No+league+chosen");
  const from = text(form, "from");
  const to = text(form, "to") || from;
  try {
    const result = await importFixtures(league, season, from, to, adminId);
    redirect(`/matches?imported=${result.fetched}&league=${league}&from=${from}&to=${to}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    log.error("fixture import failed", err);
    redirect(`/matches?error=${encodeURIComponent(message)}`);
  }
}

export async function actionManualResult(form: FormData): Promise<void> {
  const adminId = await admin();
  const fixtureId = num(form, "fixture_id");
  const competitionId = num(form, "competition_id");

  if (text(form, "clear") === "1") {
    await clearManualResult(fixtureId);
    await audit(adminId, "fixture.clear_manual",
      `Manual result for match #${fixtureId} cleared`, "fixture", fixtureId);
  } else {
    const home = num(form, "home_goals", -1);
    const away = num(form, "away_goals", -1);
    if (home < 0 || away < 0) {
      redirect(`/competitions/${competitionId}?error=Result+incomplete`);
    }
    // Typing a result for a match that has not kicked off locks the API out of
    // that fixture for good, and the invented score is what the competition is
    // then scored against. Refused unless he says he means it.
    if (text(form, "confirm") !== "1" && (await kickoffInFuture(fixtureId))) {
      redirect(
        `/competitions/${competitionId}?confirm_result=${fixtureId}` +
          `&home=${home}&away=${away}`,
      );
    }
    await setManualResult(fixtureId, home, away);
    await audit(adminId, "fixture.manual_result",
      `Result for match #${fixtureId} set by hand to ${home}:${away}`,
      "fixture", fixtureId);
  }
  // Re-score straight away, so the leaderboard he is looking at is the one the
  // correction produced rather than the one before it.
  if (competitionId) await evaluateCompetition(competitionId);
  redirect(`/competitions/${competitionId}?saved=1`);
}

// ---------------------------------------------------------------- giveaway
export async function actionDrawGiveaway(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  try {
    const result = await drawGiveaway(id, adminId);
    // The prize row is created here, not by the worker: a giveaway never goes
    // through evaluateCompetition, so nothing else would ever write it and the
    // winner would be missing from the list of what he owes.
    await createGiveawayPrize(id);
    redirect(`/competitions/${id}?drawn=${result.poolSize}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/competitions/${id}?error=${encodeURIComponent(message)}`);
  }
}

/** Tell the winner privately. Separate from the draw, and retryable. */
export async function actionNotifyWinner(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  try {
    const outcome = await notifyGiveawayWinner(id, adminId);
    redirect(
      outcome.ok
        ? `/competitions/${id}?notified=1`
        : `/competitions/${id}?notify_failed=${encodeURIComponent(outcome.error!)}`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/competitions/${id}?error=${encodeURIComponent(message)}`);
  }
}

/** Publish the result in the channel. Separate again - he may not want to. */
export async function actionAnnounceWinner(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  try {
    await announceGiveawayWinner(id, adminId);
    redirect(`/competitions/${id}?winner_announced=1`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/competitions/${id}?error=${encodeURIComponent(message)}`);
  }
}

/** Mark a prize paid and write his own note against it. */
export async function actionPrizeNote(form: FormData): Promise<void> {
  const adminId = await admin();
  const competitionId = num(form, "competition_id");
  const prizeId = num(form, "prize_id");
  const note = text(form, "notes");
  const markPaid = form.get("mark_paid") === "on";

  await query(
    `UPDATE prizes
        SET notes = $2,
            status  = CASE WHEN $3 THEN 'paid' ELSE status END,
            paid_at = CASE WHEN $3 THEN COALESCE(paid_at, now()) ELSE paid_at END
      WHERE id = $1`,
    [prizeId, note || null, markPaid],
  );
  await audit(adminId, "prize.note",
    markPaid ? `Prize #${prizeId} marked as paid` : `Note added to prize #${prizeId}`,
    "prize", prizeId);
  redirect(`/competitions/${competitionId}?saved=1`);
}

// ---------------------------------------------------------------- prizes
export async function actionMarkPaid(form: FormData): Promise<void> {
  const adminId = await admin();
  await markPrizePaid(num(form, "prize_id"), adminId);
  revalidatePath("/winners");
  redirect("/winners?saved=1");
}

// ---------------------------------------------------------------- templates
export async function actionSaveTemplate(form: FormData): Promise<void> {
  const adminId = await admin();
  const key = text(form, "key");
  let buttons: unknown = [];
  const raw = text(form, "buttons");
  if (raw) {
    try {
      buttons = JSON.parse(raw);
    } catch {
      redirect(`/telegram?template=${key}&error=Buttons+are+not+valid+JSON`);
    }
  }
  await saveTemplate(key, text(form, "body"), buttons as any);
  await audit(adminId, "template.save", `Template "${key}" changed`, "template", key);
  redirect(`/telegram?template=${key}&saved=1`);
}

export async function actionSendTemplate(form: FormData): Promise<void> {
  const adminId = await admin();
  const key = text(form, "key");
  const competitionId = num(form, "competition_id") || null;
  // Imported here rather than at the top: this pulls in the Telegram client,
  // and only this one action needs it.
  const { sendToChannel } = await import("@/worker/announce.ts");
  const { render, money, when } = await import("@/lib/templates.ts");

  const [competition] = competitionId
    ? await query<any>("SELECT * FROM competitions WHERE id = $1", [competitionId])
    : [null];

  const message = await render(key, {
    name: competition?.name ?? "",
    prize: competition ? money(competition.prize_amount, competition.currency) : "",
    lock_time: competition ? when(competition.locks_at) : "",
    description: competition?.description ?? "",
    winner_count: competition?.winner_count ?? 1,
  });

  try {
    await sendToChannel(competitionId, message);
    await audit(adminId, "telegram.publish", `Template "${key}" sent to the channel`);
    redirect(`/telegram?sent_ok=1`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message2 = err instanceof Error ? err.message : String(err);
    redirect(`/telegram?error=${encodeURIComponent(message2)}`);
  }
}

// ---------------------------------------------------------------- broadcasts
/**
 * Build the text of a broadcast and put it in the queue.
 *
 * Rendering happens here, once, and the finished text is stored - so what he
 * previewed and approved is byte for byte what goes out, even if he edits the
 * template a minute later while it is still sending.
 */
async function renderBroadcastBody(
  key: string,
  competitionId: number | null,
): Promise<{ text: string; buttons: any[] }> {
  const { render } = await import("@/lib/templates.ts");
  const { competitionVars } = await import("@/lib/messagevars.ts");
  const message = await render(key, await competitionVars(competitionId));
  return { text: message.text, buttons: message.buttons };
}

/** The one-click "tell everyone about this competition" on the detail page. */
export async function actionAnnounce(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  const audience = (text(form, "audience") || "both") as Audience;

  // The template follows the competition type, chosen by the same function the
  // worker uses. Announcing a giveaway with the MoneyRace template is what put
  // "⚽ 0 Spiele · 0 Tipps" under a €20 prize draw in his channel.
  const [row] = await query<{ type: string }>(
    "SELECT type FROM competitions WHERE id = $1",
    [id],
  );
  const { announcementTemplate } = await import("@/lib/messagevars.ts");
  const key = text(form, "key") || announcementTemplate(row?.type ?? "moneyrace");

  try {
    const built = await renderBroadcastBody(key, id);
    const queued = await queueBroadcast({
      body: built.text,
      buttons: built.buttons,
      audience,
      competitionId: id,
      templateKey: key,
      adminUserId: adminId,
    });
    await audit(adminId, "broadcast.queue",
      `Announcement queued (${audience}, ${queued.recipients} recipients)`,
      "competition", id);
    redirect(`/competitions/${id}?announced=${queued.recipients}&to=${audience}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/competitions/${id}?error=${encodeURIComponent(message)}`);
  }
}

/** The free-text / template broadcast on the Telegram page. */
export async function actionBroadcast(form: FormData): Promise<void> {
  const adminId = await admin();
  const audience = (text(form, "audience") || "channel") as Audience;
  const competitionId = num(form, "competition_id") || null;
  const key = text(form, "key");
  const typed = text(form, "body");

  try {
    // A typed message wins over the template: if he wrote something in the box
    // he means to send that, not the template the dropdown happens to show.
    const built = typed
      ? { text: typed, buttons: [] as any[] }
      : await renderBroadcastBody(key, competitionId);

    const queued = await queueBroadcast({
      body: built.text,
      buttons: built.buttons,
      audience,
      competitionId,
      templateKey: typed ? null : key,
      adminUserId: adminId,
    });
    await audit(adminId, "broadcast.queue",
      `Broadcast queued (${audience}, ${queued.recipients} recipients)`);
    redirect(`/telegram?queued=${queued.recipients}&to=${audience}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/telegram?error=${encodeURIComponent(message)}`);
  }
}

export async function actionRetryNotification(form: FormData): Promise<void> {
  await admin();
  await query(
    "UPDATE notifications SET attempts = 0, last_error = NULL WHERE id = $1",
    [num(form, "notification_id")],
  );
  redirect("/telegram?retry=1");
}

// ---------------------------------------------------------------- settings
export async function actionSaveSettings(form: FormData): Promise<void> {
  const adminId = await admin();
  const keys = [
    "brand_name", "competition_brand", "bot_username", "channel_chat_id",
    "channel_invite_url", "timezone", "currency", "rules_text",
  ];
  for (const key of keys) {
    const value = text(form, key);
    // An empty box means "not set", which is a JSON null - not the string "".
    await setSetting(key, value === "" ? null : value);
  }
  await setSetting("reminder_hours_before_lock", num(form, "reminder_hours_before_lock", 1));
  await setSetting("football_default_season", num(form, "football_default_season", 2026));
  await audit(adminId, "settings.save", "Settings changed");
  redirect("/settings?saved=1");
}

export async function actionLogout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
