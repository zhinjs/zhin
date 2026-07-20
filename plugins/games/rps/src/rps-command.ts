import type { Message, Plugin } from '@zhin.js/core';
import { channelKey } from '@zhin.js/game-kit';
import { continueGame, startGame } from './game-flow.js';
import type { SessionService } from './session-service.js';

export const RPS_HELP = [
  '✊✋✌️ 猜拳对决（三局两胜）',
  '猜拳 / rps — 帮助',
  '猜拳 开始 — 新对局',
  '猜拳 继续 — 刷新界面',
  '猜拳 放弃 — 结束对局',
].join('\n');

export async function runRpsCommand(
  plugin: Plugin | null,
  services: SessionService,
  message: Message<any>,
  action: string,
): Promise<string | undefined> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.getActiveByChannel(ch);
    const lines = [RPS_HELP, ''];
    if (active) {
      lines.push(`进行中：${active.player_name} · ${active.player_wins}:${active.bot_wins}`);
    } else {
      lines.push('暂无对局，发送「猜拳 开始」或从游戏大厅进入。');
    }
    return lines.join('\n');
  }

  if (action === 'start') return startGame(plugin, services, message);
  if (action === 'continue') return continueGame(plugin, services, message);

  if (action === 'quit') {
    const row = await services.getActiveForUser(ch, userId);
    if (!row) return '你没有进行中的猜拳。';
    await services.updateSession(row.id, { status: 'aborted' });
    return '已放弃猜拳对局。';
  }

  return `未知子命令：${action}\n\n${RPS_HELP}`;
}

/** Plugin Runtime / smoke: text-only, no Adapter.editMessage. */
export async function runRpsCommandText(
  services: SessionService,
  message: Message<any>,
  action: string,
): Promise<string> {
  return (await runRpsCommand(null, services, message, action)) ?? '';
}
