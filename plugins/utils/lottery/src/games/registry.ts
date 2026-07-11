import type { GameId, LotterySource } from '../types.js';

export interface GameMeta {
  id: GameId;
  name: string;
  source: LotterySource;
  fucaiName?: string;
  ticaiGameNo?: string;
}

export const ALL_GAMES: GameMeta[] = [
  { id: 'kl8', name: '快乐8', source: 'fucai', fucaiName: 'kl8' },
  { id: 'ssq', name: '双色球', source: 'fucai', fucaiName: 'ssq' },
  { id: 'fc3d', name: '福彩3D', source: 'fucai', fucaiName: '3d' },
  { id: 'dlt', name: '超级大乐透', source: 'ticai', ticaiGameNo: '85' },
  { id: 'pl3', name: '排列3', source: 'ticai', ticaiGameNo: '35' },
  { id: 'pl5', name: '排列5', source: 'ticai', ticaiGameNo: '350133' },
];

const BY_ID = new Map(ALL_GAMES.map((g) => [g.id, g]));

export function getGameMeta(id: GameId): GameMeta {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`Unknown game: ${id}`);
  return meta;
}

export function parseGameId(raw: string): GameId | null {
  const key = raw.trim().toLowerCase();
  const aliases: Record<string, GameId> = {
    kl8: 'kl8',
    '快乐8': 'kl8',
    ssq: 'ssq',
    '双色球': 'ssq',
    dlt: 'dlt',
    '大乐透': 'dlt',
    fc3d: 'fc3d',
    '福彩3d': 'fc3d',
    pl3: 'pl3',
    '排列3': 'pl3',
    pl5: 'pl5',
    '排列5': 'pl5',
  };
  return aliases[key] ?? (BY_ID.has(key as GameId) ? (key as GameId) : null);
}

export function resolveEnabledGames(configGames?: string[]): GameId[] {
  if (!configGames?.length) return ALL_GAMES.map((g) => g.id);
  const out: GameId[] = [];
  for (const g of configGames) {
    const id = parseGameId(g);
    if (id && !out.includes(id)) out.push(id);
  }
  return out.length ? out : ALL_GAMES.map((x) => x.id);
}
