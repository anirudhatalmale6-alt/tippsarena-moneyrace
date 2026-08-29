/**
 * Publishing to the Telegram channel (spec §4 and §30).
 *
 * Kept apart from the worker's schedule so the admin dashboard can publish the
 * same message by hand through the same code path - one implementation, so a
 * manual announcement and an automatic one cannot drift apart.
 */
import { Api, InlineKeyboard } from "grammy";
import { config } from "../lib/config.ts";
import { getSetting, query } from "../lib/db.ts";
import { log } from "../lib/log.ts";
import type { TemplateButton } from "../lib/templates.ts";

// Its own Api rather than the bot instance: the worker is a separate process
// and must not start a second long-poll against the same token.
// Exported so the tests can install a transformer on it and assert on what
// WOULD have been sent. Without that they would have to either talk to Telegram
// for real or not test this path at all, and the people in the users table are
// his actual customers.
export const api = new Api(config.botToken);

export interface RenderedMessage {
  text: string;
  buttons: TemplateButton[];
  parseMode: string;
}

async function buildKeyboard(
  buttons: TemplateButton[],
  competitionId: number | null,
): Promise<InlineKeyboard | undefined> {
  if (!buttons.length) return undefined;
  const username =
    (await getSetting<string>("bot_username", config.botUsername)) ??
    config.botUsername;
  const keyboard = new InlineKeyboard();
  let used = 0;

  for (const button of buttons) {
    if (button.action === "deeplink") {
      const payload = competitionId ? `?start=c_${competitionId}` : "";
      keyboard.url(button.text, `https://t.me/${username}${payload}`).row();
      used += 1;
    } else if (button.action === "url" && button.url) {
      keyboard.url(button.text, button.url).row();
      used += 1;
    } else if (button.action === "channel") {
      const url = await getSetting<string>("channel_invite_url", null);
      if (url) {
        keyboard.url(button.text, url).row();
        used += 1;
      }
    }
    // A callback button on a channel post would do nothing for the reader -
    // there is no chat behind it - so those are dropped rather than shipped
    // as a button that does not respond.
  }
  return used ? keyboard : undefined;
}

/**
 * Send one message to the configured channel and record it.
 *
 * Throws if the channel is not configured or Telegram refuses, so the caller
 * can retry. Every send, successful or not, leaves a row behind.
 */
export async function sendToChannel(
  competitionId: number | null,
  message: RenderedMessage,
): Promise<number> {
  const channel = await getSetting<string>("channel_chat_id", null);
  if (!channel) {
    throw new Error(
      "channel_chat_id is not set - configure the channel in Einstellungen",
    );
  }

  const keyboard = await buildKeyboard(message.buttons, competitionId);

  try {
    const sent = await api.sendMessage(channel, message.text, {
      parse_mode: (message.parseMode as "HTML") ?? "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    await query(
      `INSERT INTO telegram_messages
         (competition_id, chat_id, message_id, body, status)
       VALUES ($1, $2, $3, $4, 'sent')`,
      [competitionId, String(channel), sent.message_id, message.text],
    );
    log.info(`published to ${channel}: message ${sent.message_id}`);
    return sent.message_id;
  } catch (err) {
    await query(
      `INSERT INTO telegram_messages
         (competition_id, chat_id, body, status, error)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [
        competitionId,
        String(channel),
        message.text,
        String(err instanceof Error ? err.message : err),
      ],
    );
    throw err;
  }
}

/** Direct message to one user. Used for reminders to entrants. */
export async function sendToUser(
  telegramId: number,
  message: RenderedMessage,
  competitionId: number | null = null,
): Promise<boolean> {
  try {
    await api.sendMessage(telegramId, message.text, {
      parse_mode: (message.parseMode as "HTML") ?? "HTML",
      reply_markup: await buildKeyboard(message.buttons, competitionId),
    });
    return true;
  } catch (err) {
    // Someone who never started the bot, or who blocked it. Not an error worth
    // stopping a broadcast for.
    log.debug(`DM to ${telegramId} failed: ${err}`);
    return false;
  }
}
