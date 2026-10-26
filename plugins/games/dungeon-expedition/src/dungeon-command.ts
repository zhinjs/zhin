import { createMessages } from 'zhin.js/i18n';
import { gameCommandHint, channelKey, type GameMessageLike, type GameReply } from '@zhin.js/game-kit';
import {
  continueDungeon,
  handleDungeonChoice,
  startDungeon,
} from './game-flow.js';
import type { SessionService } from './session-service.js';
import { dungeonSessionToken } from './view.js';

const messages = createMessages({
  title: { 'zh-CN': '地牢远征 · 1-4 人确定性回合冒险', en: 'Dungeon Expedition · Turn-based adventure for 1–4 players' },
  start: { 'zh-CN': '创建远征队', en: 'Create a party' },
  join: { 'zh-CN': '加入当前频道的队伍', en: 'Join this channel’s party' },
  ready: { 'zh-CN': '切换准备状态', en: 'Toggle readiness' },
  go: { 'zh-CN': '队长开始远征', en: 'Leader starts the expedition' },
  explore: { 'zh-CN': '探索下一房间', en: 'Explore the next room' },
  attack: { 'zh-CN': '攻击', en: 'Attack' }, defend: { 'zh-CN': '防御', en: 'Defend' }, potion: { 'zh-CN': '使用药水', en: 'Use a potion' },
  status: { 'zh-CN': '刷新当前界面', en: 'View current status' },
  abort: { 'zh-CN': '队长结束远征', en: 'Leader ends the expedition' },
  empty: { 'zh-CN': '当前频道没有远征队。', en: 'This channel has no expedition party.' },
});
export function getDungeonHelp(message: Pick<GameMessageLike, 'locale' | 'formatCommand'> = {}): string {
  const command = message.formatCommand?.('dungeon');
  const actions = ['start', 'join', 'ready', 'go', 'explore', 'attack', 'defend', 'potion', 'status', 'abort'] as const;
  return [messages(message.locale, 'title'), ...(command === undefined ? [] : actions.map(action => `${command} ${action} — ${messages(message.locale, action)}`))].join('\n');
}
export const DUNGEON_HELP = getDungeonHelp();

const ACTION_ALIASES: Readonly<Record<string, string>> = {
  '': 'status',
  help: 'help',
  帮助: 'help',
  start: 'create',
  开始: 'create',
  create: 'create',
  创建: 'create',
  status: 'status',
  状态: 'status',
  continue: 'status',
  继续: 'status',
  join: 'join',
  加入: 'join',
  ready: 'ready',
  准备: 'ready',
  go: 'start',
  出发: 'start',
  explore: 'explore',
  探索: 'explore',
  attack: 'attack',
  攻击: 'attack',
  defend: 'defend',
  防御: 'defend',
  potion: 'potion',
  药水: 'potion',
  quit: 'abort',
  abort: 'abort',
  结束: 'abort',
  放弃: 'abort',
};

export function normalizeDungeonAction(action: string): string | null {
  return ACTION_ALIASES[action.trim().toLowerCase()] ?? null;
}

export async function runDungeonCommand(
  service: SessionService,
  message: GameMessageLike,
  rawAction: string,
): Promise<GameReply> {
  const action = normalizeDungeonAction(rawAction);
  if (!action || action === 'help') return getDungeonHelp(message);
  if (action === 'create') return startDungeon(service, message);
  if (action === 'status') return continueDungeon(service, message);

  const session = await service.getActiveByChannel(channelKey(message));
  if (!session) return messages(message.locale, 'empty') + gameCommandHint(message, 'dungeon');
  return handleDungeonChoice(
    service,
    message,
    dungeonSessionToken(session),
    action,
  );
}
