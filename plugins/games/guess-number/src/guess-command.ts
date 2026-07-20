import type { Message, Plugin } from 'zhin.js';
import { channelKey } from '@zhin.js/game-kit';
import { startGame } from './game-flow.js';
import { formatStatus, type SessionService } from './session-service.js';

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
  message: Message<any>,
  action: string,
): Promise<string> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.getActiveForUser(ch, userId);
    const lines = [GUESS_HELP, ''];
    if (active) {
      lines.push(formatStatus(active));
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
    return '已放弃本局猜数字。';
  }

  return `未知子命令：${action}\n\n${GUESS_HELP}`;
}
