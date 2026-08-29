/**
 * The TippsArena MoneyRace bot.
 *
 * The funnel from spec §3, in order:
 *   /start (with the ad or referral deep link)  ->  welcome
 *   -> join the channel  ->  membership verified
 *   -> enter a competition  ->  one match at a time  ->  locked
 *
 * Everything a user reads comes from message_templates in the database. The
 * only German in this file is in labels for buttons the operator did not ask to
 * control, and those are in bot/labels.ts so they are still in one place.
 */
import { Bot, GrammyError, HttpError, InlineKeyboard } from "grammy";
import { config } from "../lib/config.ts";
import { getSetting, query, one } from "../lib/db.ts";
import { log } from "../lib/log.ts";
import {
  competitionFixtures,
  getCompetition,
  isOpenForPredictions,
  joinCompetition,
  leaderboard,
  listOpenCompetitions,
  predictionsOf,
  PredictionsLockedError,
  savePrediction,
  type Competition,
  type CompetitionFixture,
} from "../lib/competitions.ts";
import { money, render, when, escapeHtml } from "../lib/templates.ts";
import {
  parseStartPayload,
  profile,
  recentResults,
  rememberMembership,
  upsertUser,
  type User,
} from "../lib/users.ts";
import { L } from "./labels.ts";

export const bot = new Bot(config.botToken);

// --------------------------------------------------------------- helpers
async function timezone(): Promise<string> {
  return (await getSetting<string>("timezone", "Europe/Berlin")) ?? "Europe/Berlin";
}

async function botUsername(): Promise<string> {
  return (
    (await getSetting<string>("bot_username", config.botUsername)) ??
    config.botUsername
  );
}

/** Turn a template's button list into a real keyboard. */
async function keyboardFor(
  buttons: Array<{ text: string; action?: string; url?: string; data?: string }>,
  vars: { competitionId?: number } = {},
): Promise<InlineKeyboard | undefined> {
  if (!buttons.length) return undefined;
  const keyboard = new InlineKeyboard();
  for (const button of buttons) {
    switch (button.action) {
      case "channel": {
        const url = await getSetting<string>("channel_invite_url", null);
        if (url) keyboard.url(button.text, url).row();
        break;
      }
      case "deeplink": {
        const username = await botUsername();
        const payload = vars.competitionId ? `?start=c_${vars.competitionId}` : "";
        keyboard.url(button.text, `https://t.me/${username}${payload}`).row();
        break;
      }
      case "url":
        if (button.url) keyboard.url(button.text, button.url).row();
        break;
      default:
        keyboard.text(button.text, button.data ?? button.action ?? "menu").row();
    }
  }
  return keyboard;
}

/**
 * Is this user in the channel?
 *
 * Answered from Telegram every time it is asked, never from the cached column -
 * somebody can leave between one screen and the next, and the cached value is
 * for the dashboard's statistics, not for the gate.
 */
async function isChannelMember(telegramId: number): Promise<boolean | null> {
  const channel = await getSetting<string>("channel_chat_id", null);
  if (!channel) return null; // not configured yet: the gate cannot be applied

  try {
    const member = await bot.api.getChatMember(channel, telegramId);
    return ["creator", "administrator", "member", "restricted"].includes(
      member.status,
    );
  } catch (err) {
    // "user not found" means not a member. Anything else is our problem, not
    // theirs, and must not be turned into a refusal.
    const message = err instanceof GrammyError ? err.description : String(err);
    if (/not found/i.test(message)) return false;
    log.error(`membership check failed for ${telegramId}`, err);
    return null;
  }
}

async function mainMenu(): Promise<InlineKeyboard> {
  return new InlineKeyboard()
    .text(L.enterCompetition, "competitions").row()
    .text(L.leaderboard, "leaderboard").row()
    .text(L.myProfile, "profile").text(L.myResults, "results").row()
    .text(L.invite, "invite").text(L.rules, "rules").row();
}

// --------------------------------------------------------------- /start
bot.command("start", async (ctx) => {
  const payload = parseStartPayload(ctx.match as string);
  const { user } = await upsertUser(ctx.from!, payload);

  // start=c_<id> comes from a channel announcement button: take them straight
  // into that competition rather than making them find it in a menu.
  const direct = /^c_(\d+)$/.exec(payload.raw ?? "");
  if (direct) {
    await showCompetition(ctx, user, Number(direct[1]));
    return;
  }

  const welcome = await render("bot_welcome");
  const keyboard = new InlineKeyboard().text(L.startNow, "menu");
  await ctx.reply(welcome.text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
});

bot.callbackQuery("menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const menu = await render("bot_menu");
  await ctx.reply(menu.text, {
    parse_mode: "HTML",
    reply_markup: await mainMenu(),
  });
});

// --------------------------------------------------------------- competitions
bot.callbackQuery("competitions", async (ctx) => {
  await ctx.answerCallbackQuery();
  const open = await listOpenCompetitions();
  if (!open.length) {
    await ctx.reply(L.noCompetitions, { reply_markup: await mainMenu() });
    return;
  }
  const tz = await timezone();
  const keyboard = new InlineKeyboard();
  for (const competition of open) {
    keyboard
      .text(
        `${competition.name} — ${money(competition.prize_amount, competition.currency)}`,
        `comp_${competition.id}`,
      )
      .row();
  }
  await ctx.reply(L.pickCompetition, { reply_markup: keyboard });
});

bot.callbackQuery(/^comp_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const { user } = await upsertUser(ctx.from!);
  await showCompetition(ctx, user, Number(ctx.match![1]));
});

async function showCompetition(
  ctx: any,
  user: User,
  competitionId: number,
): Promise<void> {
  const competition = await getCompetition(competitionId);
  if (!competition) {
    await ctx.reply(L.notFound, { reply_markup: await mainMenu() });
    return;
  }

  if (!isOpenForPredictions(competition)) {
    const locked = await render("predictions_locked");
    await ctx.reply(locked.text, {
      parse_mode: "HTML",
      reply_markup: await mainMenu(),
    });
    return;
  }

  // The gate (spec §6), applied per competition because he wanted it optional.
  if (competition.requires_membership) {
    const member = await isChannelMember(user.telegram_id);
    if (member === false) {
      await rememberMembership(user.id, false);
      const prompt = await render("membership_required");
      await ctx.reply(prompt.text, {
        parse_mode: "HTML",
        reply_markup: await keyboardFor(prompt.buttons, { competitionId }),
      });
      return;
    }
    if (member === true) await rememberMembership(user.id, true);
    // member === null: the channel is not configured or Telegram was unhappy.
    // Letting them in is the right call - a broken check must not close the
    // funnel, and the operator sees the warning in the log.
  }

  const fixtures = await competitionFixtures(competitionId);
  const tz = await timezone();
  const intro = await render("competition_intro", {
    name: competition.name,
    prize: money(competition.prize_amount, competition.currency),
    match_count: fixtures.length,
    lock_time: when(competition.locks_at, tz),
  });

  const participant = await joinCompetition(competitionId, user.id);
  const keyboard = new InlineKeyboard().text(
    participant.completed ? L.reviewPicks : L.startPicks,
    `play_${competitionId}_0`,
  );
  await ctx.reply(intro.text, { parse_mode: "HTML", reply_markup: keyboard });
}

// --------------------------------------------------------------- predicting
/** One match, with the three answers. Position is 0-based. */
bot.callbackQuery(/^play_(\d+)_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const competitionId = Number(ctx.match![1]);
  const index = Number(ctx.match![2]);
  const { user } = await upsertUser(ctx.from!);
  await askMatch(ctx, user, competitionId, index);
});

async function askMatch(
  ctx: any,
  user: User,
  competitionId: number,
  index: number,
): Promise<void> {
  const competition = await getCompetition(competitionId);
  if (!competition) return;

  if (!isOpenForPredictions(competition)) {
    const locked = await render("predictions_locked");
    await ctx.reply(locked.text, {
      parse_mode: "HTML",
      reply_markup: await mainMenu(),
    });
    return;
  }

  const fixtures = await competitionFixtures(competitionId);
  if (index >= fixtures.length) {
    await finishPicks(ctx, user, competition, fixtures);
    return;
  }

  const participant = await joinCompetition(competitionId, user.id);
  const existing = await predictionsOf(participant.id);
  const fixture = fixtures[index];
  const current = existing.get(fixture.competition_fixture_id);

  const tick = (pick: string) => (current?.pick === pick ? " ✅" : "");
  const keyboard = new InlineKeyboard()
    .text(
      `🔴 ${fixture.home_team}${tick("H")}`,
      `pick_${competitionId}_${index}_H`,
    ).row()
    .text(`🤝 ${L.draw}${tick("D")}`, `pick_${competitionId}_${index}_D`).row()
    .text(
      `🟡 ${fixture.away_team}${tick("A")}`,
      `pick_${competitionId}_${index}_A`,
    ).row();

  if (index > 0) {
    keyboard.text(L.back, `play_${competitionId}_${index - 1}`);
  }
  if (index < fixtures.length - 1) {
    keyboard.text(L.skip, `play_${competitionId}_${index + 1}`);
  }

  const tz = await timezone();
  const text =
    `⚽ <b>${L.matchOf(index + 1, fixtures.length)}</b>\n\n` +
    `<b>${escapeHtml(fixture.home_team)}</b> — <b>${escapeHtml(fixture.away_team)}</b>\n` +
    `🕒 ${when(fixture.kickoff_at, tz)}`;

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}

bot.callbackQuery(/^pick_(\d+)_(\d+)_([HDA])$/, async (ctx) => {
  const competitionId = Number(ctx.match![1]);
  const index = Number(ctx.match![2]);
  const pick = ctx.match![3] as "H" | "D" | "A";

  const { user } = await upsertUser(ctx.from!);
  const fixtures = await competitionFixtures(competitionId);
  const fixture = fixtures[index];
  if (!fixture) {
    await ctx.answerCallbackQuery();
    return;
  }

  const participant = await joinCompetition(competitionId, user.id);

  try {
    await savePrediction(
      competitionId,
      participant.id,
      fixture.competition_fixture_id,
      { pick },
    );
  } catch (err) {
    if (err instanceof PredictionsLockedError) {
      await ctx.answerCallbackQuery({ text: L.lockedAlert, show_alert: true });
      const locked = await render("predictions_locked");
      await ctx.reply(locked.text, {
        parse_mode: "HTML",
        reply_markup: await mainMenu(),
      });
      return;
    }
    throw err;
  }

  await ctx.answerCallbackQuery({ text: L.saved });
  await askMatch(ctx, user, competitionId, index + 1);
});

async function finishPicks(
  ctx: any,
  user: User,
  competition: Competition,
  fixtures: CompetitionFixture[],
): Promise<void> {
  const participant = await joinCompetition(competition.id, user.id);
  const made = await predictionsOf(participant.id);
  const done = fixtures.filter((f) =>
    made.get(f.competition_fixture_id)?.pick,
  ).length;

  const saved = await render("predictions_saved", {
    name: competition.name,
    done,
    total: fixtures.length,
    prize: money(competition.prize_amount, competition.currency),
  });

  const keyboard = new InlineKeyboard();
  if (done < fixtures.length) {
    // Never let somebody leave thinking they are entered when they are not.
    keyboard.text(L.completeMissing, `play_${competition.id}_0`).row();
  }
  keyboard.text(L.backToMenu, "menu");

  await ctx.reply(saved.text, { parse_mode: "HTML", reply_markup: keyboard });
}

// --------------------------------------------------------------- membership
bot.callbackQuery("check_membership", async (ctx) => {
  const { user } = await upsertUser(ctx.from!);
  const member = await isChannelMember(user.telegram_id);

  if (member === null) {
    await ctx.answerCallbackQuery();
    await ctx.reply(L.checkUnavailable, { reply_markup: await mainMenu() });
    return;
  }

  await rememberMembership(user.id, member);
  await ctx.answerCallbackQuery();
  const reply = await render(member ? "membership_ok" : "membership_missing");
  await ctx.reply(reply.text, {
    parse_mode: "HTML",
    reply_markup: member ? await mainMenu() : undefined,
  });
});

// --------------------------------------------------------------- profile
bot.callbackQuery("profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  const { user } = await upsertUser(ctx.from!);
  const stats = await profile(user.id);
  const name = user.username ? `@${user.username}` : (user.first_name ?? "-");

  await ctx.reply(
    `🏆 <b>${L.yourProfile}</b>\n\n` +
      `${escapeHtml(name)}\n` +
      `MoneyRace Punkte: <b>${stats.points}</b>\n` +
      `Teilnahmen: ${stats.competitions}\n` +
      `Siege: ${stats.wins}\n` +
      `Top 3: ${stats.top3}\n` +
      `Einladungen: ${stats.referrals}`,
    { parse_mode: "HTML", reply_markup: await mainMenu() },
  );
});

bot.callbackQuery("results", async (ctx) => {
  await ctx.answerCallbackQuery();
  const { user } = await upsertUser(ctx.from!);
  const rows = await recentResults(user.id);
  if (!rows.length) {
    await ctx.reply(L.noResults, { reply_markup: await mainMenu() });
    return;
  }
  const lines = rows.map(
    (r) =>
      `🏁 <b>${escapeHtml(r.name)}</b>\n` +
      `   ${r.correct_count}/${r.total} richtig · ${r.points} Punkte` +
      (r.rank ? ` · Platz #${r.rank}` : ` · ${L.pendingEvaluation}`),
  );
  await ctx.reply(`📊 <b>${L.myResults}</b>\n\n${lines.join("\n\n")}`, {
    parse_mode: "HTML",
    reply_markup: await mainMenu(),
  });
});

// --------------------------------------------------------------- leaderboard
bot.callbackQuery("leaderboard", async (ctx) => {
  await ctx.answerCallbackQuery();
  const recent = await one<{ id: number; name: string }>(
    `SELECT id, name FROM competitions
      WHERE status IN ('open','locked','evaluating','finished')
      ORDER BY COALESCE(locks_at, created_at) DESC LIMIT 1`,
  );
  if (!recent) {
    await ctx.reply(L.noCompetitions, { reply_markup: await mainMenu() });
    return;
  }
  await ctx.reply(await leaderboardText(recent.id, recent.name), {
    parse_mode: "HTML",
    reply_markup: await mainMenu(),
  });
});

export async function leaderboardText(
  competitionId: number,
  name: string,
  limit = 10,
): Promise<string> {
  const rows = await leaderboard(competitionId, limit);
  if (!rows.length) return `🏁 <b>${escapeHtml(name)}</b>\n\n${L.noEntries}`;

  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.map((row, i) => {
    const badge = medals[i] ?? `${i + 1}️⃣`;
    const who = row.username ? `@${row.username}` : (row.first_name ?? "?");
    return `${badge} ${escapeHtml(who)} — ${row.points} Punkte`;
  });
  return `🏁 <b>${escapeHtml(name)}</b>\n\n${lines.join("\n")}`;
}

// --------------------------------------------------------------- invite/rules
bot.callbackQuery("invite", async (ctx) => {
  await ctx.answerCallbackQuery();
  const username = await botUsername();
  const link = `https://t.me/${username}?start=ref_${ctx.from!.id}`;
  await ctx.reply(
    `🔗 <b>${L.inviteTitle}</b>\n\n${L.inviteBody}\n\n<code>${link}</code>`,
    { parse_mode: "HTML", reply_markup: await mainMenu() },
  );
});

bot.callbackQuery("rules", async (ctx) => {
  await ctx.answerCallbackQuery();
  const rules = await getSetting<string>("rules_text", "");
  await ctx.reply(rules || L.noRules, {
    parse_mode: "HTML",
    reply_markup: await mainMenu(),
  });
});

// --------------------------------------------------------------- errors
bot.catch((err) => {
  const ctx = err.ctx;
  const where = `update ${ctx?.update?.update_id}`;
  if (err.error instanceof GrammyError) {
    log.error(`${where}: telegram said "${err.error.description}"`);
  } else if (err.error instanceof HttpError) {
    log.error(`${where}: could not reach telegram`, err.error);
  } else {
    log.error(`${where}: unhandled`, err.error);
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  log.info("TippsArena MoneyRace bot starting");
  bot.start({
    onStart: (me) => log.info(`bot online as @${me.username} (${me.id})`),
  });
}
