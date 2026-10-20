import {
  channelKey,
  type GameMessageLike,
  type GameReply,
} from '@zhin.js/game-kit';
import {
  continueDungeon,
  handleDungeonChoice,
  startDungeon,
} from './game-flow.js';
import type { SessionService } from './session-service.js';
import { dungeonSessionToken } from './view.js';

export const DUNGEON_HELP = [
  '地牢远征 · 1-4 人确定性回合冒险',
  '地牢 开始 — 创建远征队',
  '地牢 加入 — 加入当前频道的队伍',
  '地牢 准备 — 切换准备状态',
  '地牢 出发 — 队长开始远征',
  '地牢 探索 — 探索下一房间',
  '地牢 攻击 / 防御 / 药水 — 战斗操作',
  '地牢 状态 — 刷新当前界面',
  '地牢 结束 — 队长结束远征',
].join('\n');

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
  if (!action || action === 'help') return DUNGEON_HELP;
  if (action === 'create') return startDungeon(service, message);
  if (action === 'status') return continueDungeon(service, message);

  const session = await service.getActiveByChannel(channelKey(message));
  if (!session) return '当前频道没有远征队。发送「地牢 开始」创建。';
  return handleDungeonChoice(
    service,
    message,
    dungeonSessionToken(session),
    action,
  );
}
