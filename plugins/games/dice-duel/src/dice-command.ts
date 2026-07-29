import { channelKey, type GameMessageLike } from '@zhin.js/game-kit';
import { continueGame, startGame } from './game-flow.js';
import type { SessionService } from './session-service.js';

export const DICE_HELP = [
  '🎲 骰子对决（三局两胜）',
  '骰子 / dice — 帮助',
  '骰子 开始 — 新对局',
  '骰子 继续 — 刷新界面',
  '骰子 放弃 — 结束对局',
].join('\n');

export async function runDiceCommand(
  services: SessionService,
  message: GameMessageLike,
  action: string,
): Promise<string> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.getActiveByChannel(ch);
    const lines = [DICE_HELP, ''];
    if (active) {
      lines.push(`进行中：${active.player_name} · ${active.player_wins}:${active.bot_wins}`);
    } else {
      lines.push('暂无对局，发送「骰子 开始」或从游戏大厅进入。');
    }
    return lines.join('\n');
  }

  if (action === 'start') return (await startGame(services, message)) ?? '';
  if (action === 'continue') return continueGame(services, message);

  if (action === 'quit') {
    const row = await services.getActiveForUser(ch, userId);
    if (!row) return '你没有进行中的骰子对决。';
    await services.updateSession(row.id, { status: 'aborted' });
    return '已放弃骰子对局。';
  }

  return `未知子命令：${action}\n\n${DICE_HELP}`;
}
