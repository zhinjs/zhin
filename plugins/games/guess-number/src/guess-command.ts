import {
  channelKey,
  type GameMessageLike,
  type GameReply,
} from '@zhin.js/game-kit';
import { startGame } from './game-flow.js';
import type { SessionService } from './session-service.js';
import { buildGuessView } from './view.js';

export const GUESS_HELP = [
  '🔢 猜数字（1~100，7 次机会）',
  '猜数 / guess — 帮助',
  '猜数 开始 — 新一局',
  '猜数 放弃 — 结束当前局',
  '',
  '进行中直接回复数字即可。',
].join('\n');

export async function runGuessCommand(
  services: SessionService,
  message: GameMessageLike,
  action: string,
): Promise<GameReply> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.getActiveForUser(ch, userId);
    const lines = [GUESS_HELP, ''];
    if (active) {
      return buildGuessView(active, [GUESS_HELP], message.$channel.type);
    } else {
      lines.push('暂无对局，发送「猜数 开始」。');
    }
    return lines.join('\n');
  }

  if (action === 'start') return startGame(services, message);

  if (action === 'quit') {
    const row = await services.getActiveForUser(ch, userId);
    if (!row) return '你没有进行中的猜数字。';
    await services.updateSession(row.id, { status: 'aborted' });
    const updated = (await services.getById(row.id))!;
    return buildGuessView(updated, ['已放弃本局。'], message.$channel.type);
  }

  return `未知子命令：${action}\n\n${GUESS_HELP}`;
}
