import type { Message, Plugin } from '@zhin.js/core';
import { continueGame, startGame } from './game-flow.js';
import type { SessionService } from './session-service.js';

export const BJ_HELP = [
  '🃏 **21 点**',
  '',
  '尽量让手牌点数接近 21 且不超过，比庄家大即获胜。',
  '',
  '• `/21点 开始` — 新局',
  '• `/21点 继续` — 刷新界面',
  '• 对局中点击 **要牌** / **停牌**',
].join('\n');

export async function runBjCommand(
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
  action: string,
): Promise<string | undefined> {
  const a = action.trim().toLowerCase() || 'help';
  if (a === 'help' || a === '帮助') return BJ_HELP;
  if (a === 'start' || a === '开始') return startGame(plugin, services, message);
  if (a === 'continue' || a === '继续') return continueGame(plugin, services, message);
  return `未知操作「${action}」。发送 \`/21点 帮助\`。`;
}

/** Plugin Runtime / smoke: text-only, no Adapter.editMessage. */
export async function runBjCommandText(
  services: SessionService,
  message: Message<any>,
  action: string,
): Promise<string> {
  return (await runBjCommand(null, services, message, action)) ?? '';
}
