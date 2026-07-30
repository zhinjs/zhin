import type { GameMessageLike, GameReply } from '@zhin.js/game-kit';
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

/**
 * Plugin Runtime: render the board as text. Interactive in-place board editing
 * (the old Adapter.editMessage path) is not part of the runtime flow; commands
 * and the choice middleware return fresh text each turn.
 */
function renderView(
  session: RpsSessionRow,
  message: GameMessageLike,
  lastRound?: { player: RpsMove; bot: RpsMove; result: 0 | 1 | 2 },
): GameReply {
  return buildRpsView(session, lastRound, message.$channel.type);
}

export async function startGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<GameReply | undefined> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.getActiveByChannel(ch);
  if (active) {
    if (active.player_id === message.$sender.id) {
      return '你已有进行中的猜拳，发送「猜拳 继续」刷新，或「猜拳 放弃」。';
    }
    return `本频道 ${active.player_name} 正在猜拳对决中。`;
  }
  const session = await services.createSession(message);
  return renderView(session, message);
}

export async function handleChoice(
  services: SessionService,
  message: GameMessageLike,
  sessionId: string,
  choiceId: string,
): Promise<GameReply | null> {
  const session = await services.getById(sessionId);
  if (!session) return '对局不存在。';
  if (session.status !== 'active' && choiceId !== 'restart') {
    return '对局已结束，请点击再来一局。';
  }
  if (session.player_id !== message.$sender.id) return '这是别人的对局。';

  if (choiceId === 'restart') {
    await services.updateSession(session.id, { status: 'aborted' });
    return (await startGame(services, message)) ?? null;
  }
  if (choiceId === 'quit') {
    await services.updateSession(session.id, { status: 'aborted' });
    return renderView((await services.getById(session.id))!, message);
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
  return renderView(updated, message, { player, bot, result });
}

export async function continueGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<GameReply> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的猜拳，发送「猜拳 开始」。';
  return renderView(session, message);
}

export { RPS_PREFIX };
