/**
 * The funnel, end to end, through the real handlers.
 *
 * The unit tests prove the scoring and the lock. This proves the thing a user
 * actually touches: /start with an ad link, the menu, picking a competition,
 * answering a match, and being refused after the lock. It drives grammY's own
 * update handling and intercepts the outgoing API calls, so what is asserted is
 * what Telegram would have been sent.
 *
 * It builds its own competition and deletes it again, so it can be run twice.
 */
import { bot } from "../bot/index.ts";
import { closePool, one, query } from "../lib/db.ts";

let failures: string[] = [];
let passes = 0;

function check(name: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    passes += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}\n        got  ${a}\n        want ${b}`);
  }
}
function truthy(name: string, got: unknown): void {
  check(name, Boolean(got), true);
}

// --------------------------------------------------------------- interception
interface Sent {
  method: string;
  payload: any;
}
const sent: Sent[] = [];
let messageId = 1000;

bot.api.config.use(async (_prev, method, payload) => {
  sent.push({ method, payload });
  // Enough of a reply for grammY to carry on with. Nothing leaves this process.
  return {
    ok: true,
    result: {
      message_id: ++messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: (payload as any)?.chat_id ?? 1, type: "private" },
      text: (payload as any)?.text ?? "",
    },
  } as any;
});

// Set by hand so nothing calls getMe - this test never touches the network.
// The id is a placeholder; nothing here depends on it being the real one.
bot.botInfo = {
  id: 1,
  is_bot: true,
  first_name: "TippsArenaMoneyrace",
  username: "TippsArenaMoneyrace_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as any;

const TG_ID = -900_000 - Math.floor(Math.random() * 100_000);
const FROM = {
  id: TG_ID,
  is_bot: false,
  first_name: "Testnutzer",
  username: "testnutzer",
  language_code: "de",
};
const CHAT = { id: TG_ID, type: "private" as const, first_name: "Testnutzer" };

let updateId = 1;

async function sendText(text: string): Promise<Sent[]> {
  sent.length = 0;
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: CHAT,
      from: FROM,
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }]
        : undefined,
    },
  } as any);
  return [...sent];
}

async function tap(data: string): Promise<Sent[]> {
  sent.length = 0;
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: FROM,
      chat_instance: "1",
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: CHAT,
        text: "-",
      },
    },
  } as any);
  return [...sent];
}

const texts = (calls: Sent[]) =>
  calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string);
const keyboards = (calls: Sent[]) =>
  calls
    .filter((c) => c.method === "sendMessage")
    .flatMap((c) => c.payload.reply_markup?.inline_keyboard ?? []);

// --------------------------------------------------------------- fixtures
const tag = `bottest-${process.pid}-${Date.now()}`;

const comp = (await query<{ id: number }>(
  `INSERT INTO competitions
     (name, type, status, prize_amount, winner_count, requires_membership,
      opens_at, locks_at, published_at)
   VALUES ($1,'moneyrace','open',250,1,false,
           now() - interval '1 hour', now() + interval '2 hours', now())
   RETURNING id`,
  [tag],
))[0];

const fixtureIds: number[] = [];
for (const [home, away] of [
  ["Bayern Muenchen", "Borussia Dortmund"],
  ["RB Leipzig", "Werder Bremen"],
]) {
  const f = (await query<{ id: number }>(
    `INSERT INTO fixtures (provider, external_id, home_team, away_team, kickoff_at, status)
     VALUES ('test', $1, $2, $3, now() + interval '3 hours', 'NS') RETURNING id`,
    [-Math.floor(Math.random() * 9_000_000) - 1, home, away],
  ))[0];
  fixtureIds.push(f.id);
}
await query(
  `INSERT INTO competition_fixtures (competition_id, fixture_id, position)
   VALUES ($1,$2,1), ($1,$3,2)`,
  [comp.id, fixtureIds[0], fixtureIds[1]],
);

// =============================================================== /start
{
  const calls = await sendText("/start meta_campaign_1");
  const body = texts(calls).join("\n");
  truthy("the welcome goes out", calls.length > 0);
  truthy("...in German, with his wording", body.includes("WILLKOMMEN BEI TIPPSARENA MONEYRACE"));
  truthy("...saying it is free", body.includes("Die Teilnahme ist kostenlos"));
  check(
    "...with one button to start",
    keyboards(calls)[0]?.map((b: any) => b.text),
    ["🏁 JETZT STARTEN"],
  );

  const user = await one<{ id: number; campaign_source_id: number | null }>(
    "SELECT id, campaign_source_id FROM users WHERE telegram_id = $1",
    [TG_ID],
  );
  truthy("the user is recorded", user !== null);
  truthy("...and so is where the ad sent them", user!.campaign_source_id !== null);
  check(
    "...under the campaign code from the link",
    (await one<{ code: string }>(
      "SELECT code FROM campaign_sources WHERE id = $1",
      [user!.campaign_source_id],
    ))?.code,
    "meta_campaign_1",
  );
}

// =============================================================== the menu
{
  const calls = await tap("menu");
  const labels = keyboards(calls).flat().map((b: any) => b.text);
  truthy("the menu offers the competition", labels.some((t: string) => t.includes("TEILNEHMEN")));
  truthy("...the leaderboard", labels.some((t: string) => t.includes("LEADERBOARD")));
  truthy("...the profile", labels.some((t: string) => t.includes("MEIN PROFIL")));
  truthy("...and the rules", labels.some((t: string) => t.includes("REGELN")));
  truthy(
    "no English leaks into the menu",
    !labels.join(" ").match(/\b(Start|Join|Rules|Profile|Results)\b/),
  );
}

// =============================================================== entering
{
  const calls = await tap(`comp_${comp.id}`);
  const body = texts(calls).join("\n");
  truthy("the competition screen names it", body.includes(tag));
  truthy("...quotes the prize in euros", body.includes("250 €"));
  truthy("...counts the matches", body.includes("2 Spiele"));
  truthy(
    "...and offers to take the picks",
    keyboards(calls).flat().some((b: any) => b.text.includes("TIPPS")),
  );

  const participant = await one<{ id: number }>(
    `SELECT pa.id FROM participants pa JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1 AND u.telegram_id = $2`,
    [comp.id, TG_ID],
  );
  truthy("opening the competition enters them", participant !== null);
}

// =============================================================== predicting
{
  const calls = await tap(`play_${comp.id}_0`);
  const body = texts(calls).join("\n");
  truthy("the first match is asked about", body.includes("SPIEL 1 VON 2"));
  truthy("...naming both teams", body.includes("Bayern Muenchen") && body.includes("Borussia Dortmund"));

  const rows = keyboards(calls);
  const labels = rows.flat().map((b: any) => b.text);
  check("three answers are offered", labels.slice(0, 3), [
    "🔴 Bayern Muenchen",
    "🤝 Unentschieden",
    "🟡 Borussia Dortmund",
  ]);

  const after = await tap(`pick_${comp.id}_0_H`);
  const stored = await one<{ pick: string }>(
    `SELECT pr.pick FROM predictions pr
       JOIN participants pa ON pa.id = pr.participant_id
       JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1 AND u.telegram_id = $2
      ORDER BY pr.id LIMIT 1`,
    [comp.id, TG_ID],
  );
  check("the pick is stored", stored?.pick, "H");
  truthy(
    "...and it moves straight on to the second match",
    texts(after).join("\n").includes("SPIEL 2 VON 2"),
  );

  const done = await tap(`pick_${comp.id}_1_A`);
  const body2 = texts(done).join("\n");
  truthy("finishing the set confirms it", body2.includes("DEINE TIPPS WURDEN GESPEICHERT"));
  truthy("...with the count", body2.includes("2/2 Tipps abgegeben"));

  check(
    "both picks are stored",
    (await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM predictions pr
         JOIN participants pa ON pa.id = pr.participant_id
         JOIN users u ON u.id = pa.user_id
        WHERE pa.competition_id = $1 AND u.telegram_id = $2`,
      [comp.id, TG_ID],
    ))?.n,
    2,
  );
  truthy(
    "the participant is marked complete",
    (await one<{ completed: boolean }>(
      `SELECT pa.completed FROM participants pa JOIN users u ON u.id = pa.user_id
        WHERE pa.competition_id = $1 AND u.telegram_id = $2`,
      [comp.id, TG_ID],
    ))?.completed,
  );
}

// ======================================================= one entry per person
// He reported being able to give his predictions "twice". Walking the whole
// funnel a second time is exactly what he did - so this walks it again and
// counts the rows, rather than trusting that the UNIQUE constraints hold.
{
  const again = await tap(`comp_${comp.id}`);
  const body = texts(again).join("\n");
  truthy("coming back says you are already in", body.includes("DU BIST BEREITS DABEI"));
  truthy("...and shows the picks it is holding", body.includes("DEINE TIPPS"));
  truthy(
    "...naming the team that was picked",
    body.includes("Bayern Muenchen") && body.includes("Werder Bremen"),
  );
  truthy("...says the entry counts once", body.includes("zählt einmal"));
  const labels = keyboards(again).flat().map((b: any) => b.text);
  truthy("changing the picks is a deliberate button", labels.includes("✏️ TIPPS ÄNDERN"));
  truthy("...next to a way out", labels.includes("◀️ ZUM MENÜ"));

  // Now actually do it a second time, start to finish.
  await tap(`play_${comp.id}_0`);
  await tap(`pick_${comp.id}_0_A`);
  await tap(`pick_${comp.id}_1_H`);

  check(
    "a second run through leaves ONE entry, not two",
    (await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM participants pa JOIN users u ON u.id = pa.user_id
        WHERE pa.competition_id = $1 AND u.telegram_id = $2`,
      [comp.id, TG_ID],
    ))?.n,
    1,
  );
  check(
    "...and TWO predictions, not four",
    (await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM predictions pr
         JOIN participants pa ON pa.id = pr.participant_id
         JOIN users u ON u.id = pa.user_id
        WHERE pa.competition_id = $1 AND u.telegram_id = $2`,
      [comp.id, TG_ID],
    ))?.n,
    2,
  );
  check(
    "...the picks were overwritten, not added to",
    (await query<{ pick: string }>(
      `SELECT pr.pick FROM predictions pr
         JOIN participants pa ON pa.id = pr.participant_id
         JOIN users u ON u.id = pa.user_id
        WHERE pa.competition_id = $1 AND u.telegram_id = $2
        ORDER BY pr.competition_fixture_id`,
      [comp.id, TG_ID],
    )).map((row) => row.pick),
    ["A", "H"],
  );

  // Put the first answer back, because the lock test below asserts on it.
  await tap(`pick_${comp.id}_0_H`);
}

// =============================================================== the lock
{
  await query(
    "UPDATE competitions SET locks_at = now() - interval '1 minute' WHERE id = $1",
    [comp.id],
  );

  const calls = await tap(`pick_${comp.id}_0_D`);
  const body = texts(calls).join("\n");
  truthy("a pick after the lock is answered in German", body.includes("GESCHLOSSEN"));
  check(
    "...and the stored pick did NOT change",
    (await one<{ pick: string }>(
      `SELECT pr.pick FROM predictions pr
         JOIN participants pa ON pa.id = pr.participant_id
         JOIN users u ON u.id = pa.user_id
        WHERE pa.competition_id = $1 AND u.telegram_id = $2
        ORDER BY pr.id LIMIT 1`,
      [comp.id, TG_ID],
    ))?.pick,
    "H",
  );

  const opened = await tap(`comp_${comp.id}`);
  truthy(
    "and the competition itself now says it is closed",
    texts(opened).join("\n").includes("GESCHLOSSEN"),
  );
}

// =============================================================== profile
{
  const calls = await tap("profile");
  const body = texts(calls).join("\n");
  truthy("the profile shows their name", body.includes("@testnutzer"));
  truthy("...their points", body.includes("MoneyRace Punkte"));
  truthy("...and their invitations", body.includes("Einladungen"));

  const invite = await tap("invite");
  truthy(
    "the invite link is personal to them",
    texts(invite).join("\n").includes(`start=ref_${TG_ID}`),
  );
}

// =============================================================== clean up
await query("DELETE FROM competitions WHERE id = $1", [comp.id]);
await query("DELETE FROM fixtures WHERE id = ANY($1)", [fixtureIds]);
await query("DELETE FROM users WHERE telegram_id = $1", [TG_ID]);
await query("DELETE FROM campaign_sources WHERE code = 'meta_campaign_1'");
check(
  "the test data is gone again",
  (await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM users WHERE telegram_id = $1",
    [TG_ID],
  ))?.n,
  0,
);

console.log(
  `\n${failures.length ? `FAILURES: ${failures.join(", ")}` : "ALL PASSED"}  ` +
    `(${passes} passed, ${failures.length} failed)`,
);
await closePool();
process.exit(failures.length ? 1 : 0);
