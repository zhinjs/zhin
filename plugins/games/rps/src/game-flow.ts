import type { Adapter, Message, Plugin } from 'zhin.js';
import { recordGameOutcome } from '@zhin.js/game-shared';
import type { RpsSessionRow } from './models.js';
import {
  RPS_PREFIX,
  WIN_TARGET,
  randomBotMove,
  resolveRound,
  type RpsMove,
} from './engine.js';
import type { SessionService } from './session-service.js';
import { buildRpsView } from './view.js';

export async function sendOrEditView(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  session: RpsSessionRow,
  lastRound?: { player: RpsMove; bot: RpsMove; result: 0 | 1 | 2 },
): Promise<void> {
  const content = buildRpsView(session, lastRound, message.$channel.type);
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
      return '你已有进行中的猜拳，发送「猜拳 继续」刷新，或「猜拳 放弃」。';
    }
    return `本频道 ${active.player_name} 正在猜拳对决中。`;
  }
  const session = await services.createSession(message);
  await sendOrEditView(plugin, services, message, session);
  return undefined;
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
  if (session.status !== 'active' && choiceId !== 'restart') {
    return '对局已结束，请点击再来一局。';
  }
  if (session.player_id !== message.$sender.id) return '这是别人的对局。';

  if (choiceId === 'restart') {
    await services.updateSession(session.id, { status: 'aborted' });
    await startGame(plugin, services, message);
    return null;
  }

  const player = choiceId as RpsMove;
  if (!['rock', 'paper', 'scissors'].includes(player)) return '无效出拳。';

  const bot = randomBotMove();
  const result = resolveRound(player, bot);
  let playerWins = session.player_wins;
  let botWins = session.bot_wins;
  if (result === 1) playerWins++;
  if (result === 2) botWins++;

  let status: RpsSessionRow['status'] = 'active';
  if (playerWins >= WIN_TARGET) status = 'won';
  else if (botWins >= WIN_TARGET) status = 'lost';

  await services.updateSession(session.id, {
    player_wins: playerWins,
    bot_wins: botWins,
    round: session.round + 1,
    status,
  });

  const updated = (await services.getById(session.id))!;
  if (status === 'won') void recordGameOutcome(message, 'rps', 'won', playerWins * 10);
  else if (status === 'lost') void recordGameOutcome(message, 'rps', 'lost');
  await sendOrEditView(plugin, services, message, updated, { player, bot, result });
  return null;
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
  if (!session) return '你没有进行中的猜拳，发送「猜拳 开始」。';
  await sendOrEditView(plugin, services, message, session);
  return '已刷新猜拳界面。';
}

export { RPS_PREFIX };
