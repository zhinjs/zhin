import type { Message, Plugin } from '@zhin.js/core';
import { channelKey } from '@zhin.js/game-kit';
import { formatPlayerWithMark, formatRosterLine } from './player-label.js';
import { startBotGame, startPvpGame } from './game-flow.js';
import type { SessionServices } from './session-service.js';

export const TTT_HELP = [
  '井字棋',
  '井字棋 / ttt — 本帮助与频道状态',
  '井字棋 人机 — 人机对战（私聊或单人）',
  '井字棋 排队 — 群聊排队（满 2 人自动开局）',
  '井字棋 离开 — 离开排队',
  '井字棋 认输 — 结束当前局',
  '井字棋 观战 — 订阅观战推送',
].join('\n');

export async function runTttCommand(
  plugin: Plugin | null,
  services: SessionServices,
  message: Message<any>,
  action: string,
): Promise<string | undefined> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.session.getActiveByChannel(ch);
    const q = await services.queue.count(ch);
    const lines = [TTT_HELP, ''];
    if (active) lines.push(`进行中：${formatRosterLine(active)}`);
    if (q > 0) lines.push(`排队：${q} 人`);
    if (!active && q === 0) lines.push('暂无对局，发送「井字棋 人机」或从游戏大厅进入。');
    return lines.join('\n');
  }

  if (action === 'join') {
    if (message.$channel.type === 'private') {
      return '私聊请使用「井字棋 人机」。';
    }
    const inGame = await services.session.getActiveForUser(ch, userId);
    if (inGame) return '你已在进行中的对局里。';
    const { position } = await services.queue.join(ch, userId, message.$sender.name);
    const pair = await services.queue.tryMatch(ch);
    if (pair) {
      const [px, po] = pair;
      const board = await startPvpGame(plugin, services, message, px, po);
      const matchLine = `匹配成功！${formatPlayerWithMark(px.id, px.displayName, '✕')} vs ${formatPlayerWithMark(po.id, po.displayName, '○')}`;
      return board ? `${matchLine}\n\n${board}` : matchLine;
    }
    return `已加入排队（第 ${position} 位），凑满 2 人自动开局。`;
  }

  if (action === 'leave') {
    const ok = await services.queue.leave(ch, userId);
    return ok ? '已离开排队。' : '你不在排队中。';
  }

  if (action === 'bot') {
    return startBotGame(plugin, services, message);
  }

  if (action === 'quit') {
    const row = await services.session.getActiveForUser(ch, userId);
    if (!row) return '你没有进行中的对局。';
    await services.session.updateSession(row.id, { status: 'aborted', winner: 0 });
    return '你已认输，对局结束。';
  }

  if (action === 'spectate') {
    const active = await services.session.getActiveByChannel(ch);
    if (!active) return '当前频道没有进行中的对局。';
    await services.session.addSpectator(active.id, userId);
    return `已订阅观战（局 ${active.id}）。每步会在频道更新棋盘。`;
  }

  return `未知子命令：${action}\n\n${TTT_HELP}`;
}

/** Plugin Runtime / smoke: text-only, no Adapter.editMessage. */
export async function runTttCommandText(
  services: SessionServices,
  message: Message<any>,
  action: string,
): Promise<string> {
  return (await runTttCommand(null, services, message, action)) ?? '';
}
