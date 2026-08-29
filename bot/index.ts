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
import { getSetting, query, one, setSetting } from "../lib/db.ts";
import { log } from "../lib/log.ts";
import {
  competitionFixtures,
  getCompetition,
  isOpenForPredictions,
  joinCompetition,
  listOpenCompetitions,
  predictionsOf,
  PredictionsLockedError,
  savePrediction,
  type Competition,
  type CompetitionFixture,
} from "../lib/competitions.ts";
import { enterGiveaway } from "../lib/giveaway.ts";
import { boardText, typeBoard } from "../lib/leaderboard.ts";
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
      // g_ rather than c_: this one MEANS "enter me", so the tap in the channel
      // is the entry. c_ opens the competition and waits for a second tap,
      // which is one tap too many when the button already said TEILNEHMEN.
      case "giveaway_deeplink": {
        const username = await botUsername();
        const payload = vars.competitionId ? `?start=g_${vars.competitionId}` : "";
        keyboard.url(button.text, `https://t.me/${username}${payload}`).row();
        break;
      }
      case "enter_giveaway":
        if (vars.competitionId) {
          keyboard.text(button.text, `give_${vars.competitionId}`).row();
        }
        break;
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

  // start=g_<id> comes from a giveaway button that already said TEILNEHMEN.
  // Pressing it IS entering - anything else makes the person press the same
  // word twice and conclude the first press did not work.
  const enter = /^g_(\d+)$/.exec(payload.raw ?? "");
  if (enter) {
    await enterGiveawayNow(ctx, user, Number(enter[1]));
    return;
  }

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
  const ICON: Record<string, string> = {
    giveaway: "🎁",
    exact_score: "🎯",
    moneyrace: "🏁",
  };
  for (const competition of open) {
    keyboard
      .text(
        `${ICON[competition.type] ?? "🏁"} ${competition.name} — ` +
          `${money(competition.prize_amount, competition.currency)}`,
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

  const tz = await timezone();

  // The competition type decides the whole interface from here on. A giveaway
  // has no matches, no predictions and no lock, so none of the words below
  // ("0 Spiele", "0 Tipps", "Tippschluss") mean anything in one - and printing
  // them anyway is what made it look broken.
  if (competition.type === "giveaway") {
    await showGiveaway(ctx, user, competition);
    return;
  }

  const fixtures = await competitionFixtures(competitionId);
  const participant = await joinCompetition(competitionId, user.id);

  // Somebody who has already finished must not be dropped straight back into
  // the pick flow: it reads as a second entry even though the database can
  // only ever hold one (participants is UNIQUE on competition + user, and
  // predictions on participant + match). Show them what they already gave,
  // say plainly that it counts once, and make changing it a deliberate step.
  if (participant.completed) {
    await showEntry(ctx, participant.id, competition, fixtures, tz);
    return;
  }

  if (competition.type === "exact_score") {
    const intro = await render("exact_intro", {
      name: competition.name,
      prize: money(competition.prize_amount, competition.currency),
      match: fixtures.length
        ? `${fixtures[0].home_team} — ${fixtures[0].away_team}`
        : "-",
      lock_time: when(competition.locks_at, tz),
    });
    const keyboard = new InlineKeyboard().text(
      L.startPicks,
      `play_${competitionId}_0`,
    );
    await ctx.reply(intro.text, { parse_mode: "HTML", reply_markup: keyboard });
    return;
  }

  const intro = await render("competition_intro", {
    name: competition.name,
    prize: money(competition.prize_amount, competition.currency),
    match_count: fixtures.length,
    lock_time: when(competition.locks_at, tz),
  });

  const keyboard = new InlineKeyboard().text(
    L.startPicks,
    `play_${competitionId}_0`,
  );
  await ctx.reply(intro.text, { parse_mode: "HTML", reply_markup: keyboard });
}

// --------------------------------------------------------------- giveaways
/**
 * The giveaway screen: prize, number of winners, one button.
 *
 * Looking at it does NOT enter you. `joinCompetition` is deliberately not
 * called here - entering is the button, and only the button.
 */
async function showGiveaway(
  ctx: any,
  user: User,
  competition: Competition,
): Promise<void> {
  const already = await one<{ id: number }>(
    "SELECT id FROM participants WHERE competition_id = $1 AND user_id = $2",
    [competition.id, user.id],
  );

  if (already) {
    await showGiveawayEntry(ctx, competition);
    return;
  }

  const intro = await render("giveaway_intro", {
    name: competition.name,
    prize: money(competition.prize_amount, competition.currency),
    winner_count: competition.winner_count,
    description: competition.description ?? "",
  });

  const keyboard = new InlineKeyboard()
    .text(L.enterGiveaway, `give_${competition.id}`).row()
    .text(L.rules, "rules").row()
    .text(L.backToMenu, "menu");

  await ctx.reply(intro.text, { parse_mode: "HTML", reply_markup: keyboard });
}

/** The confirmation, and the same screen on every later visit. */
async function showGiveawayEntry(
  ctx: any,
  competition: Competition,
  justEntered = false,
): Promise<void> {
  const message = await render(
    justEntered ? "giveaway_entered" : "giveaway_already_entered",
    {
      name: competition.name,
      prize: money(competition.prize_amount, competition.currency),
    },
  );

  const keyboard = new InlineKeyboard()
    .text(L.myEntry, `give_status_${competition.id}`).row()
    .text(L.rules, "rules").row()
    .text(L.backToMenu, "menu");

  await ctx.reply(message.text, { parse_mode: "HTML", reply_markup: keyboard });
}

/**
 * Enter a giveaway and say so. One implementation, two ways in.
 *
 * Both the button inside the bot and the deep link from a channel post or a
 * broadcast land here, so they cannot behave differently - and the difference
 * that mattered was that one of them used to need a second tap.
 */
async function enterGiveawayNow(
  ctx: any,
  user: User,
  competitionId: number,
): Promise<void> {
  const competition = await getCompetition(competitionId);

  if (!competition || competition.type !== "giveaway") {
    await ctx.reply(L.notFound, { reply_markup: await mainMenu() });
    return;
  }
  if (!isOpenForPredictions(competition)) {
    const closed = await render("predictions_locked");
    await ctx.reply(closed.text, {
      parse_mode: "HTML",
      reply_markup: await mainMenu(),
    });
    return;
  }
  // The gate again, at the moment it matters: the screen he came from may have
  // been sitting on his phone since before he left the channel.
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
  }

  const { isNew } = await enterGiveaway(competitionId, user.id);
  await showGiveawayEntry(ctx, competition, isNew);
}

bot.callbackQuery(/^give_(\d+)$/, async (ctx) => {
  const competitionId = Number(ctx.match![1]);
  const { user } = await upsertUser(ctx.from!);
  const competition = await getCompetition(competitionId);

  if (competition?.type === "giveaway" && isOpenForPredictions(competition)) {
    const existing = await one<{ id: number }>(
      "SELECT id FROM participants WHERE competition_id = $1 AND user_id = $2",
      [competitionId, user.id],
    );
    await ctx.answerCallbackQuery({
      text: existing ? L.alreadyEntered : L.entered,
    });
  } else {
    await ctx.answerCallbackQuery();
  }

  await enterGiveawayNow(ctx, user, competitionId);
});

bot.callbackQuery(/^give_status_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const competitionId = Number(ctx.match![1]);
  const { user } = await upsertUser(ctx.from!);
  const competition = await getCompetition(competitionId);
  if (!competition) return;

  const entry = await one<{ joined_at: Date; is_winner: boolean }>(
    "SELECT joined_at, is_winner FROM participants WHERE competition_id = $1 AND user_id = $2",
    [competitionId, user.id],
  );
  const tz = await timezone();

  // Their own entry and nothing else. A participant list is admin-only (§9):
  // the entrants are other people's data, and nobody here needs to see it.
  const text = entry
    ? `🎁 <b>${escapeHtml(competition.name)}</b>\n\n` +
      `✅ ${L.youAreIn}\n` +
      `🕒 ${when(entry.joined_at, tz)}\n` +
      (entry.is_winner ? `\n🏆 <b>${L.youWon}</b>` : `\n${L.drawPending}`)
    : `${L.notEntered}`;

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text(L.backToMenu, "menu"),
  });
});

/** The "you are already in" screen, with the picks they gave. */
async function showEntry(
  ctx: any,
  participantId: number,
  competition: Competition,
  fixtures: CompetitionFixture[],
  tz: string,
): Promise<void> {
  const made = await predictionsOf(participantId);
  const PICK_LABEL: Record<string, (f: CompetitionFixture) => string> = {
    H: (f) => f.home_team,
    D: () => L.draw,
    A: (f) => f.away_team,
  };
  const exact = competition.type === "exact_score";

  const lines = fixtures.map((fixture) => {
    const answer = made.get(fixture.competition_fixture_id);
    // An exact-score entry is read back as the scoreline he typed. Showing
    // "Mainz" there would be true and useless - it is not what he chose.
    const chosen = exact
      ? answer?.homeGoals !== null && answer?.homeGoals !== undefined &&
        answer?.awayGoals !== null && answer?.awayGoals !== undefined
        ? `${answer.homeGoals}:${answer.awayGoals}`
        : "—"
      : answer?.pick
      ? PICK_LABEL[answer.pick](fixture)
      : "—";
    return (
      `${escapeHtml(fixture.home_team)} — ${escapeHtml(fixture.away_team)}\n` +
      `   ➜ <b>${escapeHtml(chosen)}</b>`
    );
  });

  const entry = await render("already_entered", {
    name: competition.name,
    prize: money(competition.prize_amount, competition.currency),
    lock_time: when(competition.locks_at, tz),
  });

  const keyboard = new InlineKeyboard()
    .text(L.changePicks, `play_${competition.id}_0`).row()
    .text(L.backToMenu, "menu");

  await ctx.reply(
    `${entry.text}\n\n📋 <b>${L.yourPicks}</b>\n\n${lines.join("\n")}`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
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

  // An exact-score competition asks for a scoreline, never for home/draw/away.
  if (competition.type === "exact_score") {
    await askExactScore(
      ctx,
      competition,
      fixtures,
      index,
      current?.homeGoals ?? 0,
      current?.awayGoals ?? 0,
      false,
    );
    return;
  }

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

// ------------------------------------------------------------ exact score
const MAX_GOALS = 20;

/**
 * The scoreline picker: two counters and a submit button.
 *
 * The score in progress lives in the callback data, not in the database and not
 * in memory. Two consequences that both matter: nothing is written until he
 * presses TIPP ABGEBEN, so a half-adjusted counter is never a stored
 * prediction; and the bot can be restarted mid-tap without losing where he was.
 */
async function askExactScore(
  ctx: any,
  competition: Competition,
  fixtures: CompetitionFixture[],
  index: number,
  home: number,
  away: number,
  edit: boolean,
): Promise<void> {
  const fixture = fixtures[index];
  const tz = await timezone();
  const h = Math.min(MAX_GOALS, Math.max(0, home));
  const a = Math.min(MAX_GOALS, Math.max(0, away));
  const at = `${competition.id}_${index}_${h}_${a}`;

  const keyboard = new InlineKeyboard()
    .text("➖", `exh_${at}_-1`)
    .text(`${escapeHtml(fixture.home_team)}: ${h}`, "noop")
    .text("➕", `exh_${at}_1`)
    .row()
    .text("➖", `exa_${at}_-1`)
    .text(`${escapeHtml(fixture.away_team)}: ${a}`, "noop")
    .text("➕", `exa_${at}_1`)
    .row()
    .text(L.submitScore, `exs_${at}`)
    .row();

  if (index > 0) keyboard.text(L.back, `play_${competition.id}_${index - 1}`);
  if (index < fixtures.length - 1) {
    keyboard.text(L.skip, `play_${competition.id}_${index + 1}`);
  }

  const text =
    `⚽ <b>${escapeHtml(fixture.home_team)} — ${escapeHtml(fixture.away_team)}</b>\n` +
    `🕒 ${when(fixture.kickoff_at, tz)}\n\n` +
    `<b>${L.howDoesItEnd}</b>\n\n` +
    `🎯 ${escapeHtml(fixture.home_team)} <b>${h}</b> : <b>${a}</b> ${escapeHtml(fixture.away_team)}`;

  if (edit) {
    // editMessageText throws when the text and keyboard are both unchanged -
    // which happens on every ➖ at zero. Not an error worth showing anyone.
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    } catch {
      return;
    }
  }
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}

bot.callbackQuery("noop", async (ctx) => {
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^ex([ha])_(\d+)_(\d+)_(\d+)_(\d+)_(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const which = ctx.match![1];
  const competitionId = Number(ctx.match![2]);
  const index = Number(ctx.match![3]);
  let home = Number(ctx.match![4]);
  let away = Number(ctx.match![5]);
  const delta = Number(ctx.match![6]);

  if (which === "h") home += delta;
  else away += delta;

  const competition = await getCompetition(competitionId);
  if (!competition) return;
  const fixtures = await competitionFixtures(competitionId);
  if (!fixtures[index]) return;

  await askExactScore(ctx, competition, fixtures, index, home, away, true);
});

bot.callbackQuery(/^exs_(\d+)_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
  const competitionId = Number(ctx.match![1]);
  const index = Number(ctx.match![2]);
  const home = Math.min(MAX_GOALS, Math.max(0, Number(ctx.match![3])));
  const away = Math.min(MAX_GOALS, Math.max(0, Number(ctx.match![4])));

  const { user } = await upsertUser(ctx.from!);
  const competition = await getCompetition(competitionId);
  const fixtures = await competitionFixtures(competitionId);
  const fixture = fixtures[index];
  if (!competition || !fixture) {
    await ctx.answerCallbackQuery();
    return;
  }

  const participant = await joinCompetition(competitionId, user.id);

  try {
    await savePrediction(
      competitionId,
      participant.id,
      fixture.competition_fixture_id,
      {
        // The outcome is stored alongside the scoreline, derived from it. The
        // scoring code already knows how to pay for a right outcome and add a
        // bonus for the exact score, so an exact-score competition is that same
        // machinery configured differently - not a second scoring engine.
        pick: home > away ? "H" : home < away ? "A" : "D",
        homeGoals: home,
        awayGoals: away,
      },
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

  const saved = await render("exact_saved", {
    match: `${fixture.home_team} — ${fixture.away_team}`,
    score: `${home}:${away}`,
    name: competition.name,
  });
  const keyboard = new InlineKeyboard();
  if (index < fixtures.length - 1) {
    keyboard.text(L.skip, `play_${competitionId}_${index + 1}`).row();
  }
  keyboard.text(L.changePicks, `play_${competitionId}_${index}`).row();
  keyboard.text(L.backToMenu, "menu");

  await ctx.reply(saved.text, { parse_mode: "HTML", reply_markup: keyboard });
});

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
  const rows = await recentResults(user.id, 12);
  if (!rows.length) {
    await ctx.reply(L.noResults, { reply_markup: await mainMenu() });
    return;
  }

  // Grouped by type, MoneyRace first, because they are scored on different
  // scales and reading them as one list invites the comparison his §8 says must
  // never be made. Giveaways are not here at all - recentResults excludes them.
  const races = rows.filter((r) => r.type === "moneyrace");
  const exact = rows.filter((r) => r.type === "exact_score");
  const blocks: string[] = [];

  if (races.length) {
    blocks.push(
      `🏁 <b>${L.moneyrace}</b>\n\n` +
        races
          .map((r) =>
            `<b>${escapeHtml(r.name)}</b>\n` +
            `⚽ ${r.correct_count}/${r.total} richtig\n` +
            `🏆 ${r.points} Punkte` +
            (r.rank ? `\n📊 Platz #${r.rank}` : `\n⏳ ${L.pendingEvaluation}`),
          )
          .join("\n\n"),
    );
  }

  if (exact.length) {
    blocks.push(
      `🎯 <b>${L.exactScore}</b>\n\n` +
        exact
          .map((r) => {
            const head =
              `<b>${escapeHtml(r.name)}</b>\n` +
              (r.match_name ? `⚽ ${escapeHtml(r.match_name)}\n` : "") +
              `🎯 Tipp: <b>${r.tip ?? "—"}</b>`;
            // No result yet is its own state: "falsch" would be a lie about a
            // match that has not been played.
            if (!r.final_score) return `${head}\n⏳ ${L.awaitingResult}`;
            const verdict = r.is_exact
              ? `🏆 <b>${L.exactHit}</b> +${r.points}`
              : r.is_correct
              ? `✅ ${L.rightOutcome} +${r.points}`
              : `❌ ${L.wrongTip} +${r.points}`;
            return `${head}\n📊 Ergebnis: <b>${r.final_score}</b>\n${verdict}`;
          })
          .join("\n\n"),
    );
  }

  await ctx.reply(
    `📊 <b>${L.myResults}</b>\n\n${blocks.join("\n\n———\n\n")}`,
    { parse_mode: "HTML", reply_markup: await mainMenu() },
  );
});

// --------------------------------------------------------------- leaderboard
bot.callbackQuery("leaderboard", async (ctx) => {
  await ctx.answerCallbackQuery();
  // Two tables, never one. MoneyRace points and Exact Score points are earned
  // on different scales, so a combined ranking would put people in an order
  // that means nothing (his §8). Giveaways have no points and appear in neither.
  await ctx.reply(L.whichRanking, {
    reply_markup: new InlineKeyboard()
      .text(`🏁 ${L.moneyrace}`, "rank_moneyrace").row()
      .text(`🎯 ${L.exactScore}`, "rank_exact_score").row()
      .text(L.backToMenu, "menu"),
  });
});

bot.callbackQuery(/^rank_(moneyrace|exact_score)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const type = ctx.match![1];
  const { user } = await upsertUser(ctx.from!);
  const title = `${type === "moneyrace" ? L.moneyrace : L.exactScore} ${L.ranking}`;

  // Three masked names and your own line - never the field. The size of the
  // field does not change the size of this message, which is the point: at ten
  // thousand players it is still five lines and still one query.
  const board = await typeBoard(type, user.id);
  await ctx.reply(boardText(board, title, L.noEntries), {
    parse_mode: "HTML",
    reply_markup: await mainMenu(),
  });
});

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

// --------------------------------------------------------------- channel
/**
 * Learn the channel by being put in it.
 *
 * There is no Telegram API that lists the chats a bot belongs to, so the
 * channel id has to arrive on an update. Both of these carry it: being made an
 * administrator, and any post in a channel the bot is already in.
 *
 * Only ever written when the setting is still empty, so this can never take a
 * configured channel away from him - and it is editable in Settings either way.
 */
async function rememberChannel(chat: {
  id: number;
  type: string;
  title?: string;
}): Promise<void> {
  if (chat.type !== "channel") return;
  const existing = await getSetting<string>("channel_chat_id", null);
  if (existing) return;

  await setSetting("channel_chat_id", String(chat.id));
  log.info(`channel set automatically: ${chat.title ?? "?"} (${chat.id})`);

  // The invite link is a separate permission; if it is not granted, the
  // channel still works and he can paste the link in Settings by hand.
  if (!(await getSetting<string>("channel_invite_url", null))) {
    try {
      const link = await bot.api.createChatInviteLink(chat.id, {
        name: "TippsArena Bot",
      });
      await setSetting("channel_invite_url", link.invite_link);
      log.info("channel invite link stored");
    } catch (err) {
      log.warn(
        "channel invite link could not be created - set it in Settings by hand",
        err,
      );
    }
  }
}

bot.on("my_chat_member", async (ctx) => {
  const status = ctx.myChatMember.new_chat_member.status;
  if (status === "administrator" || status === "member") {
    await rememberChannel(ctx.myChatMember.chat as any);
  }
});

bot.on("channel_post", async (ctx) => {
  await rememberChannel(ctx.channelPost.chat as any);
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
    // Spelled out rather than left to the default, because my_chat_member is
    // how the bot learns which channel it has been made an administrator of.
    allowed_updates: ["message", "callback_query", "my_chat_member", "channel_post"],
    onStart: (me) => log.info(`bot online as @${me.username} (${me.id})`),
  });
}
