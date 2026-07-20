import type { Adapter, Message, Plugin } from '@zhin.js/core';
import { plainTextFromSendContent, recordGameOutcome } from '@zhin.js/game-kit';
import type { DiceSessionRow } from './models.js';
import { compareRolls, DICE_PREFIX, rollD6, WIN_TARGET } from './engine.js';
import type { SessionService } from './session-service.js';
import { buildDiceView } from './view.js';

export async function sendOrEditView(
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
  session: DiceSessionRow,
  lastRound?: { player: number; bot: number; result: 0 | 1 | 2 },
): Promise<string | void> {
  const content = buildDiceView(session, lastRound, message.$channel.type);
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

export async function startGame(
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
): Promise<string | undefined> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.getActiveByChannel(ch);
  if (active) {
    if (active.player_id === message.$sender.id) {
      return '你已有进行中的骰子对决，发送「骰子 继续」刷新。';
    }
    return `本频道 ${active.player_name} 正在掷骰对决中。`;
  }
  const session = await services.createSession(message);
  const text = await sendOrEditView(plugin, services, message, session);
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
  if (!session) return '你没有进行中的骰子对决，发送「骰子 开始」。';
  const text = await sendOrEditView(plugin, services, message, session);
  if (typeof text === 'string') return text;
  return '已刷新骰子界面。';
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
  if (session.player_id !== message.$sender.id) return '这是别人的对局。';

  if (session.status !== 'active' && choiceId !== 'restart') {
    return '对局已结束，请点击再来一局。';
  }

  if (choiceId === 'restart') {
    await services.updateSession(session.id, { status: 'aborted' });
    // text-only 模式（plugin===null）下 startGame 的唯一输出就是返回文本
    return (await startGame(plugin, services, message)) ?? null;
  }

  if (choiceId !== 'roll') return '无效操作。';

  const player = rollD6();
  const bot = rollD6();
  const result = compareRolls(player, bot);

  let playerWins = session.player_wins;
  let botWins = session.bot_wins;
  if (result === 1) playerWins++;
  if (result === 2) botWins++;

  let status: DiceSessionRow['status'] = 'active';
  if (playerWins >= WIN_TARGET) status = 'won';
  else if (botWins >= WIN_TARGET) status = 'lost';

  await services.updateSession(session.id, {
    player_wins: playerWins,
    bot_wins: botWins,
    round: session.round + 1,
    last_player_roll: player,
    last_bot_roll: bot,
    status,
  });

  const updated = (await services.getById(session.id))!;
  if (status === 'won') void recordGameOutcome(message, 'dice', 'won', playerWins * 10);
  else if (status === 'lost') void recordGameOutcome(message, 'dice', 'lost');
  const text = await sendOrEditView(plugin, services, message, updated, { player, bot, result });
  return typeof text === 'string' ? text : null;
}

export { DICE_PREFIX };
