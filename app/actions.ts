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
  drawGiveaway,
  duplicateCompetition,
  importFixtures,
  markPrizePaid,
  publishCompetition,
  setCompetitionFixtures,
} from "@/lib/admin.ts";
import { setManualResult, clearManualResult } from "@/lib/fixtures.ts";
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
      name: text(form, "name") || "Neuer Wettbewerb",
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

  revalidatePath("/wettbewerbe");
  redirect(`/wettbewerbe/${id}?angelegt=1`);
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
            scoring = jsonb_build_object('correct_outcome', $11::numeric,
                                         'exact_score', $12::numeric),
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
    ],
  );
  await audit(adminId, "competition.update", `Wettbewerb #${id} geändert`,
    "competition", id, before[0]);
  revalidatePath(`/wettbewerbe/${id}`);
  redirect(`/wettbewerbe/${id}?gespeichert=1`);
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
    redirect(`/wettbewerbe/${id}?fehler=${encodeURIComponent(String(err))}`);
  }
  redirect(`/wettbewerbe/${id}?gespeichert=1`);
}

export async function actionPublish(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  try {
    await publishCompetition(id, adminId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/wettbewerbe/${id}?fehler=${encodeURIComponent(message)}`);
  }
  revalidatePath("/wettbewerbe");
  redirect(`/wettbewerbe/${id}?veröffentlicht=1`);
}

export async function actionDuplicate(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  const name = text(form, "name") || `Kopie von #${id}`;
  const newId = await duplicateCompetition(id, name, adminId);
  redirect(`/wettbewerbe/${newId}?angelegt=1`);
}

export async function actionSetStatus(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  const status = text(form, "status");
  if (!["draft", "open", "locked", "evaluating", "finished", "cancelled"].includes(status)) {
    redirect(`/wettbewerbe/${id}?fehler=Unbekannter+Status`);
  }
  await query("UPDATE competitions SET status = $2, updated_at = now() WHERE id = $1",
    [id, status]);
  await audit(adminId, "competition.status", `Status auf "${status}" gesetzt`,
    "competition", id);
  redirect(`/wettbewerbe/${id}?gespeichert=1`);
}

export async function actionEvaluate(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  const outcome = await evaluateCompetition(id);
  await audit(adminId, "competition.evaluate",
    `Neu ausgewertet: ${outcome.scored} Tipps, ${outcome.missingResults} ohne Ergebnis`,
    "competition", id);
  redirect(`/wettbewerbe/${id}?ausgewertet=${outcome.missingResults}`);
}

// ---------------------------------------------------------------- fixtures
export async function actionImportFixtures(form: FormData): Promise<void> {
  const adminId = await admin();
  // The dropdown carries ids confirmed against the API; the free box lets him
  // reach any other league without waiting for me to add it.
  const league = num(form, "league_custom") || num(form, "league");
  const season = num(form, "season", new Date().getFullYear());
  if (!league) redirect("/spiele?fehler=Keine+Liga+gewählt");
  const from = text(form, "from");
  const to = text(form, "to") || from;
  try {
    const result = await importFixtures(league, season, from, to, adminId);
    redirect(`/spiele?importiert=${result.fetched}&league=${league}&from=${from}&to=${to}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    log.error("fixture import failed", err);
    redirect(`/spiele?fehler=${encodeURIComponent(message)}`);
  }
}

export async function actionManualResult(form: FormData): Promise<void> {
  const adminId = await admin();
  const fixtureId = num(form, "fixture_id");
  const competitionId = num(form, "competition_id");

  if (text(form, "clear") === "1") {
    await clearManualResult(fixtureId);
    await audit(adminId, "fixture.clear_manual",
      `Manuelles Ergebnis für Spiel #${fixtureId} aufgehoben`, "fixture", fixtureId);
  } else {
    const home = num(form, "home_goals", -1);
    const away = num(form, "away_goals", -1);
    if (home < 0 || away < 0) {
      redirect(`/wettbewerbe/${competitionId}?fehler=Ergebnis+unvollständig`);
    }
    await setManualResult(fixtureId, home, away);
    await audit(adminId, "fixture.manual_result",
      `Ergebnis für Spiel #${fixtureId} von Hand auf ${home}:${away} gesetzt`,
      "fixture", fixtureId);
  }
  // Re-score straight away, so the leaderboard he is looking at is the one the
  // correction produced rather than the one before it.
  if (competitionId) await evaluateCompetition(competitionId);
  redirect(`/wettbewerbe/${competitionId}?gespeichert=1`);
}

// ---------------------------------------------------------------- giveaway
export async function actionDrawGiveaway(form: FormData): Promise<void> {
  const adminId = await admin();
  const id = num(form, "id");
  try {
    const result = await drawGiveaway(id, adminId);
    redirect(`/wettbewerbe/${id}?gelost=${result.poolSize}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    redirect(`/wettbewerbe/${id}?fehler=${encodeURIComponent(message)}`);
  }
}

// ---------------------------------------------------------------- prizes
export async function actionMarkPaid(form: FormData): Promise<void> {
  const adminId = await admin();
  await markPrizePaid(num(form, "prize_id"), adminId);
  revalidatePath("/gewinner");
  redirect("/gewinner?gespeichert=1");
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
      redirect(`/telegram?vorlage=${key}&fehler=Buttons+sind+kein+gültiges+JSON`);
    }
  }
  await saveTemplate(key, text(form, "body"), buttons as any);
  await audit(adminId, "template.save", `Vorlage "${key}" geändert`, "template", key);
  redirect(`/telegram?vorlage=${key}&gespeichert=1`);
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
    await audit(adminId, "telegram.publish", `Vorlage "${key}" in den Kanal gesendet`);
    redirect(`/telegram?gesendet=1`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) throw err;
    const message2 = err instanceof Error ? err.message : String(err);
    redirect(`/telegram?fehler=${encodeURIComponent(message2)}`);
  }
}

export async function actionRetryNotification(form: FormData): Promise<void> {
  await admin();
  await query(
    "UPDATE notifications SET attempts = 0, last_error = NULL WHERE id = $1",
    [num(form, "notification_id")],
  );
  redirect("/telegram?erneut=1");
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
  await audit(adminId, "settings.save", "Einstellungen geändert");
  redirect("/einstellungen?gespeichert=1");
}

export async function actionLogout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
