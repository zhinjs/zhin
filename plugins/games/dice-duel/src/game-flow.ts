import { plainTextFromSendContent, recordGameOutcome, type GameMessageLike } from '@zhin.js/game-kit';
import type { DiceSessionRow } from './models.js';
import { compareRolls, DICE_PREFIX, rollD6, WIN_TARGET } from './engine.js';
import type { SessionService } from './session-service.js';
import { buildDiceView } from './view.js';

/**
 * Plugin Runtime: render the board as text. Interactive in-place board editing
 * (the old Adapter.editMessage path) is not part of the runtime flow; commands
 * and the choice middleware return fresh text each turn.
 */
function renderView(
  session: DiceSessionRow,
  message: GameMessageLike,
  lastRound?: { player: number; bot: number; result: 0 | 1 | 2 },
): string {
  return plainTextFromSendContent(buildDiceView(session, lastRound, message.$channel.type));
}

export async function startGame(
  services: SessionService,
  message: GameMessageLike,
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
  return renderView(session, message);
}

export async function continueGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<string> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的骰子对决，发送「骰子 开始」。';
  return renderView(session, message);
}

export async function handleChoice(
  services: SessionService,
  message: GameMessageLike,
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
    return (await startGame(services, message)) ?? null;
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
  return renderView(updated, message, { player, bot, result });
}

export { DICE_PREFIX };
