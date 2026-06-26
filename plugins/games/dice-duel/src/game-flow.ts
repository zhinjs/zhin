import type { Adapter, Message, Plugin } from 'zhin.js';
import type { DiceSessionRow } from './models.js';
import { compareRolls, DICE_PREFIX, rollD6, WIN_TARGET } from './engine.js';
import type { SessionService } from './session-service.js';
import { buildDiceView } from './view.js';

export async function sendOrEditView(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  session: DiceSessionRow,
  lastRound?: { player: number; bot: number; result: 0 | 1 | 2 },
): Promise<void> {
  const content = buildDiceView(session, lastRound);
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
  plugin: Plugin,
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
  await sendOrEditView(plugin, services, message, session);
  return undefined;
}

export async function continueGame(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
): Promise<string> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的骰子对决，发送「骰子 开始」。';
  await sendOrEditView(plugin, services, message, session);
  return '已刷新骰子界面。';
}

export async function handleChoice(
  plugin: Plugin,
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
    await services.updateSession(session.id, {
      player_wins: 0,
      bot_wins: 0,
      round: 0,
      last_player_roll: 0,
      last_bot_roll: 0,
      status: 'active',
      board_message_id: '',
    });
    const updated = (await services.getById(session.id))!;
    await sendOrEditView(plugin, services, message, updated);
    return null;
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
  await sendOrEditView(plugin, services, message, updated, { player, bot, result });
  return null;
}

export { DICE_PREFIX };
