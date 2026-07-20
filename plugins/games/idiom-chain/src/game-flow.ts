import type { Adapter, Message, Plugin } from 'zhin.js';
import { plainTextFromSendContent } from '@zhin.js/game-kit';
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
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
  session: ChainSessionRow,
  eventLines: string[] = [],
): Promise<string | void> {
  const content = buildChainView(session, eventLines, message.$channel.type);
  if (!plugin) return plainTextFromSendContent(content);

  const adapter = plugin.root.inject(message.$adapter) as Adapter;

  if (session.board_message_id) {
    const msgId = await adapter.editMessage({
      messageId: session.board_message_id,
      context: String(message.$adapter),
      endpoint: message.$endpoint,
      id: message.$channel.id,
      type: message.$channel.type,
      content,
    });
    if (msgId !== session.board_message_id) {
      await services.updateSession(session.id, { board_message_id: msgId });
    }
    return;
  }

  const msgId = await message.$reply?.(content);
  if (msgId) await services.updateSession(session.id, { board_message_id: msgId });
}

async function botTurn(
  services: SessionService,
  session: ChainSessionRow,
  used: Set<string>,
): Promise<{ session: ChainSessionRow; lines: string[]; playerWon: boolean }> {
  const mode = sessionMode(session);
  const bot = pickBotIdiom(session.last_idiom, mode, used);
  if (!bot) {
    await services.updateSession(session.id, {
      status: 'won',
      player_score: session.player_score + 1,
    });
    const updated = (await services.getById(session.id))!;
    return { session: updated, lines: ['🎉 机器人接不上，你赢本局！'], playerWon: true };
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
    `🤖 机器人：${bot.text}${gloss ? `（${gloss}）` : ''}`,
    promptLine(bot.text, mode),
  ];
  return { session: updated, lines, playerWon: false };
}

export async function startGame(
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
  matchMode: MatchMode = 'pinyin',
): Promise<string | undefined> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.getActiveByChannel(ch);
  if (active) {
    if (active.player_id === message.$sender.id) {
      return '你已有进行中的接龙，发送「接龙 继续」刷新。';
    }
    return `本频道 ${active.player_name} 正在成语接龙。`;
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
  const text = await sendOrEditView(plugin, services, message, session, [
    `🎬 ${modeLabel(matchMode)}开局！我先出：**${starter.text}**${gloss ? `（${gloss}）` : ''}`,
    promptLine(starter.text, matchMode),
  ]);
  return typeof text === 'string' ? text : undefined;
}

export async function continueGame(
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
): Promise<string> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的接龙，发送「接龙 开始」。';
  const text = await sendOrEditView(plugin, services, message, session);
  if (typeof text === 'string') return text;
  return '已刷新接龙界面。';
}

export async function processIdiomText(
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
  raw: string,
): Promise<string | null> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const session = await services.getActiveForUser(ch, message.$sender.id);
  if (!session || session.status !== 'active') return null;

  const mode = sessionMode(session);
  const used = parseUsed(session.used_idioms);
  const idiom = normalizeInput(raw);
  const check = validatePlayerIdiom(idiom, session.last_idiom, mode, used);
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
      return (await sendOrEditView(plugin, services, message, updated, [
        check.reason!,
        '失误过多，本局结束。',
      ])) ?? null;
    }
    await services.updateSession(session.id, { wrong_count: wrong, streak: 0 });
    const updated = (await services.getById(session.id))!;
    return (await sendOrEditView(plugin, services, message, updated, [check.reason!])) ?? null;
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
  const userLine = `✅ 你：${idiom}${gloss ? `（${gloss}）` : ''}`;

  const botResult = await botTurn(services, current, used);
  return (await sendOrEditView(plugin, services, message, botResult.session, [
    userLine,
    ...botResult.lines,
  ])) ?? null;
}

export async function handleChoice(
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
  sessionId: string,
  choiceId: string,
): Promise<string | null> {
  const session = await services.getById(sessionId);
  if (!session) return '对局不存在。';
  if (session.player_id !== message.$sender.id) return '这是别人的接龙。';

  const mode = sessionMode(session);

  if (choiceId === 'restart') {
    const used = new Set<string>();
    const starter = pickStarterIdiom(used);
    used.add(starter.text);
    await services.updateSession(session.id, {
      last_idiom: starter.text,
      next_char: lastChar(starter.text),
      used_idioms: JSON.stringify([...used]),
      streak: 0,
      wrong_count: 0,
      turn: 'player',
      status: 'active',
      board_message_id: '',
    });
    const updated = (await services.getById(session.id))!;
    const gloss = starter.gloss ?? getGloss(starter.text);
    return (await sendOrEditView(plugin, services, message, updated, [
      `🎬 新一局！我先出：**${starter.text}**${gloss ? `（${gloss}）` : ''}`,
      promptLine(starter.text, mode),
    ])) ?? null;
  }

  if (session.status !== 'active') {
    return '本局已结束，请点击再来一局。';
  }

  const used = parseUsed(session.used_idioms);

  if (choiceId === 'hint') {
    const hint = pickHintIdiom(session.last_idiom, mode, used);
    if (!hint) {
      await sendOrEditView(plugin, services, message, session, ['💡 词库中暂无可用提示，你赢了！']);
      await services.updateSession(session.id, { status: 'won', player_score: session.player_score + 1 });
      const updated = (await services.getById(session.id))!;
      return (await sendOrEditView(plugin, services, message, updated)) ?? null;
    }
    const gloss = getGloss(hint);
    await services.updateSession(session.id, { hints_used: session.hints_used + 1, streak: 0 });
    const updated = (await services.getById(session.id))!;
    return (await sendOrEditView(plugin, services, message, updated, [
      `💡 提示：可试 **${hint}**${gloss ? `（${gloss}）` : ''}`,
      '（使用提示会清零连击）',
    ])) ?? null;
  }

  if (choiceId === 'skip') {
    await services.updateSession(session.id, {
      status: 'lost',
      bot_score: session.bot_score + 1,
      streak: 0,
    });
    const updated = (await services.getById(session.id))!;
    return (await sendOrEditView(plugin, services, message, updated, [
      '⏭️ 你选择跳过，机器人得一分。',
    ])) ?? null;
  }

  if (choiceId === 'quit') {
    await services.updateSession(session.id, { status: 'lost', bot_score: session.bot_score + 1 });
    const updated = (await services.getById(session.id))!;
    return (await sendOrEditView(plugin, services, message, updated, ['🏳️ 你认输了。'])) ?? null;
  }

  return '未知操作。';
}

export { CHAIN_PREFIX };
