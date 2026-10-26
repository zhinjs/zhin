import { createMessages, resolveLocale } from 'zhin.js/i18n';
import type { GameMessageLike, GameReply } from '@zhin.js/game-kit';
import {
  CHAIN_PREFIX,
  getGloss,
  lastChar,
  modeLabel,
  normalizeInput,
  pickBotIdiom,
  pickHintIdiom,
  pickStarterIdiom,
  promptLine,
  validatePlayerIdiom,
  type MatchMode,
} from './engine.js';
import type { ChainSessionRow } from './models.js';
import { parseUsed, type SessionService } from './session-service.js';
import { buildChainView, MAX_WRONG } from './view.js';

function sessionMode(session: ChainSessionRow): MatchMode {
  return session.match_mode === 'char' ? 'char' : 'pinyin';
}

export async function sendOrEditView(
  services: SessionService,
  message: GameMessageLike,
  session: ChainSessionRow,
  eventLines: string[] = [],
): Promise<GameReply> {
  const content = buildChainView(session, eventLines, message.$channel.type);
  return content;
}

async function botTurn(
  services: SessionService,
  session: ChainSessionRow,
  used: Set<string>,
): Promise<{ session: ChainSessionRow; lines: string[]; playerWon: boolean }> {
  const locale = resolveLocale(session.locale);
  const mode = sessionMode(session);
  const bot = pickBotIdiom(session.last_idiom, mode, used);
  if (!bot) {
    await services.updateSession(session.id, {
      status: 'won',
      player_score: session.player_score + 1,
    });
    const updated = (await services.getById(session.id))!;
    return { session: updated, lines: [messages(locale, 'text1')], playerWon: true };
  }

  used.add(bot.text);
  const next = lastChar(bot.text);
  const gloss = bot.gloss ?? getGloss(bot.text);
  await services.updateSession(session.id, {
    last_idiom: bot.text,
    next_char: next,
    used_idioms: JSON.stringify([...used]),
    turn: 'player',
  });
  const updated = (await services.getById(session.id))!;
  const lines = [
    messages(locale, 'text2', { p0: bot.text }) + (gloss ? `（${gloss}）` : ''),
    promptLine(bot.text, mode, locale),
  ];
  return { session: updated, lines, playerWon: false };
}

export async function startGame(
  services: SessionService,
  message: GameMessageLike,
  matchMode: MatchMode = 'pinyin',
): Promise<GameReply | undefined> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.getActiveByChannel(ch);
  const locale = resolveLocale(active ? active.locale : message.locale);
  if (active) {
    if (active.player_id === message.$sender.id) {
      return messages(locale, 'text3');
    }
    return messages(locale, 'text4', { p0: active.player_name });
  }

  const used = new Set<string>();
  const starter = pickStarterIdiom(used);
  used.add(starter.text);
  const session = await services.createSession(message, {
    text: starter.text,
    nextChar: lastChar(starter.text),
    used: [...used],
    matchMode,
  });

  const gloss = starter.gloss ?? getGloss(starter.text);
  return sendOrEditView(services, message, session, [
    messages(locale, 'text5', { p0: modeLabel(matchMode, locale), p1: starter.text }) + (gloss ? `（${gloss}）` : ''),
    promptLine(starter.text, matchMode, locale),
  ]);
}

export async function continueGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<GameReply> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session) return messages(locale, 'text6');
  return sendOrEditView(services, message, session);
}

export async function processIdiomText(
  services: SessionService,
  message: GameMessageLike,
  raw: string,
): Promise<GameReply | null> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const session = await services.getActiveForUser(ch, message.$sender.id);
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session || session.status !== 'active') return null;

  const mode = sessionMode(session);
  const used = parseUsed(session.used_idioms);
  const idiom = normalizeInput(raw);
  // 格式不合规（非四字）只提示、不扣失误：避免闲聊（「好的」「谢谢」）被累计判负
  if (!/^[\u4e00-\u9fff]{4}$/.test(idiom)) {
    return messages(locale, 'text7');
  }
  const check = validatePlayerIdiom(idiom, session.last_idiom, mode, used, locale);
  if (!check.ok) {
    const wrong = session.wrong_count + 1;
    if (wrong >= MAX_WRONG) {
      await services.updateSession(session.id, {
        wrong_count: wrong,
        status: 'lost',
        bot_score: session.bot_score + 1,
        streak: 0,
      });
      const updated = (await services.getById(session.id))!;
      return (await sendOrEditView(services, message, updated, [
        check.reason!,
        messages(locale, 'text8'),
      ])) ?? null;
    }
    await services.updateSession(session.id, { wrong_count: wrong, streak: 0 });
    const updated = (await services.getById(session.id))!;
    return (await sendOrEditView(services, message, updated, [check.reason!])) ?? null;
  }

  used.add(idiom);
  const streak = session.streak + 1;
  const best = Math.max(session.best_streak, streak);
  const nextChar = lastChar(idiom);
  const gloss = getGloss(idiom);

  await services.updateSession(session.id, {
    last_idiom: idiom,
    next_char: nextChar,
    used_idioms: JSON.stringify([...used]),
    streak,
    best_streak: best,
    wrong_count: 0,
  });

  const current = (await services.getById(session.id))!;
  const userLine = messages(locale, 'text9', { p0: idiom }) + (gloss ? `（${gloss}）` : '');

  const botResult = await botTurn(services, current, used);
  return (await sendOrEditView(services, message, botResult.session, [
    userLine,
    ...botResult.lines,
  ])) ?? null;
}

export async function handleChoice(
  services: SessionService,
  message: GameMessageLike,
  sessionId: string,
  choiceId: string,
): Promise<GameReply | null> {
  const session = await services.getById(sessionId);
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session) return messages(locale, 'text10');
  if (session.player_id !== message.$sender.id) return messages(locale, 'text11');

  const mode = sessionMode(session);

  if (choiceId === 'restart') {
    const locale = resolveLocale(message.locale);
    const used = new Set<string>();
    const starter = pickStarterIdiom(used);
    used.add(starter.text);
    await services.updateSession(session.id, {
      locale,
      last_idiom: starter.text,
      next_char: lastChar(starter.text),
      used_idioms: JSON.stringify([...used]),
      streak: 0,
      wrong_count: 0,
      turn: 'player',
      status: 'active',
    });
    const updated = (await services.getById(session.id))!;
    const gloss = starter.gloss ?? getGloss(starter.text);
    return (await sendOrEditView(services, message, updated, [
      messages(locale, 'text12', { p0: starter.text }) + (gloss ? `（${gloss}）` : ''),
      promptLine(starter.text, mode, locale),
    ])) ?? null;
  }

  if (session.status !== 'active') {
    return messages(locale, 'text13');
  }

  const used = parseUsed(session.used_idioms);

  if (choiceId === 'hint') {
    const hint = pickHintIdiom(session.last_idiom, mode, used);
    if (!hint) {
      // 先更新状态再单次发送终局视图，避免旧 session「你赢了」与终局视图双发
      await services.updateSession(session.id, { status: 'won', player_score: session.player_score + 1 });
      const updated = (await services.getById(session.id))!;
      return (await sendOrEditView(services, message, updated, [
        messages(locale, 'text14'),
      ])) ?? null;
    }
    const gloss = getGloss(hint);
    await services.updateSession(session.id, { hints_used: session.hints_used + 1, streak: 0 });
    const updated = (await services.getById(session.id))!;
    return (await sendOrEditView(services, message, updated, [
      messages(locale, 'text15', { p0: hint }) + (gloss ? `（${gloss}）` : ''),
      messages(locale, 'text16'),
    ])) ?? null;
  }

  if (choiceId === 'skip') {
    await services.updateSession(session.id, {
      status: 'lost',
      bot_score: session.bot_score + 1,
      streak: 0,
    });
    const updated = (await services.getById(session.id))!;
    return (await sendOrEditView(services, message, updated, [
      messages(locale, 'text17'),
    ])) ?? null;
  }

  if (choiceId === 'quit') {
    await services.updateSession(session.id, { status: 'lost', bot_score: session.bot_score + 1 });
    const updated = (await services.getById(session.id))!;
    return (await sendOrEditView(services, message, updated, [messages(locale, 'text18')])) ?? null;
  }

  return messages(locale, 'text19');
}

export { CHAIN_PREFIX };

const messages = createMessages({
  text1: { 'zh-CN': "🎉 机器人接不上，你赢本局！", en: "🎉 The bot has no next idiom. You win!" },
  text2: { 'zh-CN': "🤖 机器人：{p0}", en: "🤖 Bot: {p0}" },
  text3: { 'zh-CN': "你已有进行中的接龙，请使用当前对局的操作入口继续。", en: "You already have an active idiom chain. Continue using its controls." },
  text4: { 'zh-CN': "本频道 {p0} 正在成语接龙。", en: "{p0} is playing an idiom chain in this channel." },
  text5: { 'zh-CN': "🎬 {p0}开局！我先出：**{p1}**", en: "🎬 Starting {p0}! My first idiom: **{p1}**" },
  text6: { 'zh-CN': "你没有进行中的接龙。", en: "You have no active idiom chain." },
  text7: { 'zh-CN': "接龙请输入**四字成语**（这条不算失误）。", en: "Enter a **four-character Chinese idiom** (this does not count as a mistake)." },
  text8: { 'zh-CN': "失误过多，本局结束。", en: "Too many mistakes. This game has ended." },
  text9: { 'zh-CN': "✅ 你：{p0}", en: "✅ You: {p0}" },
  text10: { 'zh-CN': "对局不存在。", en: "This game no longer exists." },
  text11: { 'zh-CN': "这是别人的接龙。", en: "This idiom chain belongs to another player." },
  text12: { 'zh-CN': "🎬 新一局！我先出：**{p0}**", en: "🎬 New game! My first idiom: **{p0}**" },
  text13: { 'zh-CN': "本局已结束，请点击再来一局。", en: "This game has ended. Choose Play again." },
  text14: { 'zh-CN': "💡 词库中暂无可用提示，你赢了！", en: "💡 No next idiom is available in the dictionary. You win!" },
  text15: { 'zh-CN': "💡 提示：可试 **{p0}**", en: "💡 Hint: try **{p0}**" },
  text16: { 'zh-CN': "（使用提示会清零连击）", en: "(Using a hint resets your streak)" },
  text17: { 'zh-CN': "⏭️ 你选择跳过，机器人得一分。", en: "⏭️ You skipped. The bot gets a point." },
  text18: { 'zh-CN': "🏳️ 你认输了。", en: "🏳️ You conceded." },
  text19: { 'zh-CN': "未知操作。", en: "Unknown action." },
});
