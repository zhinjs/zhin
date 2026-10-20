import type { GameMessageLike, GameReply } from '@zhin.js/game-kit';
import { continueGame, handleChoice, startGame } from './game-flow.js';
import type { SessionService } from './session-service.js';

export const BJ_HELP = [
  '🃏 **21 点**',
  '',
  '尽量让手牌点数接近 21 且不超过，比庄家大即获胜。',
  '',
  '• `/21点 开始` — 新局',
  '• `/21点 继续` — 刷新界面',
  '• `/21点 放弃` — 结束本局',
  '• 对局中点击 **要牌** / **停牌**',
].join('\n');

export async function runBjCommand(
  services: SessionService,
  message: GameMessageLike,
  action: string,
): Promise<GameReply> {
  const a = action.trim().toLowerCase() || 'help';
  if (a === 'help' || a === '帮助') return BJ_HELP;
  if (a === 'start' || a === '开始') return (await startGame(services, message)) ?? '';
  if (a === 'continue' || a === '继续') return continueGame(services, message);
  if (a === 'quit' || a === '放弃') {
    const session = await services.getActiveForUser(
      `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
      message.$sender.id,
    );
    if (!session) return '你没有进行中的 21 点。';
    return (await handleChoice(services, message, session.id, 'quit')) ?? '';
  }
  return `未知操作「${action}」。发送 \`/21点 帮助\`。`;
}
