import type { Message, Plugin } from '@zhin.js/core';
import { channelKey } from '@zhin.js/game-kit';
import {
  continueAdventure,
  sessionSummary,
  startAdventure,
} from './game-flow.js';
import { formatAchievements, formatMapProgress, formatProgressCompact } from './profile-format.js';
import type { GameServices } from './session-service.js';

export const ADV_HELP = [
  '秘境探险 · 文字冒险',
  '冒险 / adv — 帮助与状态',
  '冒险 开始 — 开始新冒险',
  '冒险 继续 — 刷新当前场景',
  '冒险 地图 — 全图探索进度',
  '冒险 成就 — 成就列表',
  '冒险 放弃 — 放弃当前冒险',
  '',
  '推进方式：点击选项按钮，或回复数字（1、2…）',
].join('\n');

export async function runAdvCommand(
  plugin: Plugin | null,
  services: GameServices,
  message: Message<any>,
  action: string,
): Promise<string | undefined> {
  const ch = channelKey(message);
  const userId = message.$sender.id;
  const userName = message.$sender.name?.trim() || userId;

  if (!action || action === 'help') {
    const active = await services.sessions.getActiveByChannel(ch);
    const profile = await services.profiles.getOrCreate(userId, userName);
    const lines = [ADV_HELP, '', formatProgressCompact(profile), ''];
    if (active) {
      lines.push('— 当前频道 —');
      lines.push(sessionSummary(active));
    } else {
      lines.push('暂无冒险，发送「冒险 开始」或从游戏大厅进入。');
    }
    return lines.join('\n');
  }

  if (action === 'start') {
    return startAdventure(plugin, services, message);
  }

  if (action === 'continue') {
    return continueAdventure(plugin, services, message);
  }

  if (action === 'map') {
    const profile = await services.profiles.getOrCreate(userId, userName);
    return formatMapProgress(profile);
  }

  if (action === 'achievements' || action === 'achievement') {
    const profile = await services.profiles.getOrCreate(userId, userName);
    return formatAchievements(profile);
  }

  if (action === 'quit') {
    const row = await services.sessions.getActiveForUser(ch, userId);
    if (!row) return '你没有进行中的冒险。';
    await services.sessions.updateSession(row.id, { status: 'aborted' });
    return '你已放弃冒险。';
  }

  return `未知子命令：${action}\n\n${ADV_HELP}`;
}

/** Plugin Runtime / smoke: text-only, no Adapter.editMessage. */
export async function runAdvCommandText(
  services: GameServices,
  message: Message<any>,
  action: string,
): Promise<string> {
  return (await runAdvCommand(null, services, message, action)) ?? '';
}
