import {
  MessageCommand,
  type Database,
  type DatabaseFeature,
  type Message,
  type Models,
  type Plugin,
  type RelatedModel,
} from '@zhin.js/core';
import { channelKey } from './board-sender.js';
import { getRegisteredGame, getRegisteredGames } from './game-hub-feature.js';
import { createHostGameDb, type HostGameDbSource } from './memory-db.js';
import { generateCompactId } from './random.js';

export type GameRecordResult = 'won' | 'lost' | 'draw' | 'aborted';

declare module '@zhin.js/core' {
  interface Models {
    game_records: {
      id: string;
      user_id: string;
      user_name: string;
      channel_key: string;
      game_id: string;
      result: GameRecordResult;
      score: number;
      created_at: number;
    };
  }
}

export type GameRecordRow = Models['game_records'];
type GameRecordDb = Database<unknown, Models, string>;

let legacyDb: GameRecordDb | null = null;
let hostDatabases = new WeakMap<GameRecordDatabaseHost, GameRecordDb>();
const hostRegistrations: Array<{
  readonly host: GameRecordDatabaseHost;
  readonly database: GameRecordDb;
}> = [];

function activeDatabase(): GameRecordDb | null {
  return hostRegistrations[hostRegistrations.length - 1]?.database ?? legacyDb;
}

function getRecordModel(database: GameRecordDb): RelatedModel<unknown, Models, 'game_records'> {
  const model = database.models.get('game_records');
  if (!model) throw new Error('game_records not registered');
  return model as RelatedModel<unknown, Models, 'game_records'>;
}

export function registerGameRecordModels(plugin: Plugin): void {
  plugin.defineModel('game_records', {
    id: { type: 'text', primary: true },
    user_id: { type: 'text', nullable: false },
    user_name: { type: 'text', default: '' },
    channel_key: { type: 'text', nullable: false },
    game_id: { type: 'text', nullable: false },
    result: { type: 'text', nullable: false },
    score: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
}

export function initGameRecordDatabase(dbFeature: DatabaseFeature): void {
  legacyDb = dbFeature.db as GameRecordDb;
}

const GAME_RECORDS_DEFINITION: Record<string, unknown> = {
  id: { type: 'text', primary: true },
  user_id: { type: 'text', nullable: false },
  user_name: { type: 'text', default: '' },
  channel_key: { type: 'text', nullable: false },
  game_id: { type: 'text', nullable: false },
  result: { type: 'text', nullable: false },
  score: { type: 'integer', default: 0 },
  created_at: { type: 'integer', default: 0 },
};

/** Plugin Runtime DatabaseHost 的最小结构（与 @zhin.js/plugin-runtime 的 DatabaseHost 结构对齐） */
export interface GameRecordDatabaseHost extends HostGameDbSource {
  define(name: string, definition: Record<string, unknown>): void;
}

/**
 * Plugin Runtime 下用 databaseHostToken 初始化战绩库。
 * 幂等：多个游戏插件 setup 都会调用，只建一次；无 token 时保持跳过（内存/静默）。
 */
export function initGameRecordHost(host: GameRecordDatabaseHost): () => void {
  let database = hostDatabases.get(host);
  if (!database) {
    host.define('game_records', GAME_RECORDS_DEFINITION);
    database = createHostGameDb(host, ['game_records']) as unknown as GameRecordDb;
    hostDatabases.set(host, database);
  }
  const registration = Object.freeze({ host, database });
  hostRegistrations.push(registration);
  return () => {
    const index = hostRegistrations.lastIndexOf(registration);
    if (index >= 0) hostRegistrations.splice(index, 1);
  };
}

function recordId(): string {
  return generateCompactId('gr');
}

/** 对局结束时写入战绩（database 未就绪时静默跳过） */
export async function recordGameOutcome(
  message: Message<any>,
  gameId: string,
  result: GameRecordResult,
  score = 0,
): Promise<void> {
  const db = activeDatabase();
  if (!db) return;
  const row: GameRecordRow = {
    id: recordId(),
    user_id: message.$sender.id,
    user_name: String(message.$sender.name ?? message.$sender.id),
    channel_key: channelKey(message),
    game_id: gameId,
    result,
    score,
    created_at: Date.now(),
  };
  await getRecordModel(db).create(row);
}

export interface UserGameStats {
  gameId: string;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  games: number;
}

export async function getUserGameStats(
  userId: string,
  channelKeyFilter?: string,
): Promise<UserGameStats[]> {
  const db = activeDatabase();
  if (!db) return [];
  const where = channelKeyFilter
    ? { user_id: userId, channel_key: channelKeyFilter }
    : { user_id: userId };
  const rows = await getRecordModel(db).findAll(where);
  const byGame = new Map<string, UserGameStats>();
  for (const row of rows) {
    let stat = byGame.get(row.game_id);
    if (!stat) {
      stat = {
        gameId: row.game_id,
        wins: 0,
        losses: 0,
        draws: 0,
        totalScore: 0,
        games: 0,
      };
      byGame.set(row.game_id, stat);
    }
    stat.games++;
    stat.totalScore += row.score;
    if (row.result === 'won') stat.wins++;
    else if (row.result === 'lost') stat.losses++;
    else if (row.result === 'draw') stat.draws++;
  }
  return [...byGame.values()].sort((a, b) => b.wins - a.wins);
}

export interface LeaderboardEntry {
  userId: string;
  userName: string;
  wins: number;
  totalScore: number;
  games: number;
}

export async function getGameLeaderboard(
  gameId: string,
  channelKeyFilter: string,
  limit = 10,
): Promise<LeaderboardEntry[]> {
  const db = activeDatabase();
  if (!db) return [];
  const rows = await getRecordModel(db).findAll({
    game_id: gameId,
    channel_key: channelKeyFilter,
  });
  const byUser = new Map<string, LeaderboardEntry>();
  for (const row of rows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = {
        userId: row.user_id,
        userName: row.user_name,
        wins: 0,
        totalScore: 0,
        games: 0,
      };
      byUser.set(row.user_id, entry);
    }
    entry.games++;
    entry.totalScore += row.score;
    if (row.result === 'won') entry.wins++;
  }
  return [...byUser.values()]
    .sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore)
    .slice(0, limit);
}

function gameTitle(gameId: string): string {
  const g = getRegisteredGame(gameId);
  return g ? `${g.icon} ${g.title}` : gameId;
}

function formatUserStats(stats: UserGameStats[]): string {
  if (!stats.length) return '暂无战绩记录，快去 `/游戏` 开一局吧！';
  const lines = stats.map((s) => {
    const title = gameTitle(s.gameId);
    return `• ${title}：${s.wins} 胜 ${s.losses} 负${s.draws ? ` ${s.draws} 平` : ''}（${s.games} 局，得分 ${s.totalScore}）`;
  });
  return ['📊 **你的战绩**', '', ...lines].join('\n');
}

function formatLeaderboard(gameId: string, entries: LeaderboardEntry[]): string {
  const title = gameTitle(gameId);
  if (!entries.length) {
    return `${title} 在本群暂无排行，发送 \`/游戏\` 开始第一局！`;
  }
  const lines = entries.map((e, i) =>
    `${i + 1}. ${e.userName} — ${e.wins} 胜 / ${e.games} 局（得分 ${e.totalScore}）`,
  );
  return [`🏆 **${title} 本群排行**`, '', ...lines].join('\n');
}

export function mountGameRecordCommands(root: Plugin): () => void {
  const disposers: (() => void)[] = [];

  disposers.push(
    root.addCommand(
      new MessageCommand('/战绩')
        .desc('查看本人在本群的游戏战绩')
        .action(async (message) => {
          const stats = await getUserGameStats(message.$sender.id, channelKey(message));
          return formatUserStats(stats);
        }),
    ),
    root.addCommand(
      new MessageCommand('/排行')
        .desc('查看本群某游戏排行榜')
        .action(async (message, ...args) => {
          const query = args.join(' ').trim();
          const games = getRegisteredGames();
          if (!games.length) return '暂无已注册游戏。';
          let gameId = games[0]!.id;
          if (query) {
            const hit = games.find(
              (g) => g.id === query
                || g.title.includes(query)
                || g.commandPrefix.includes(query)
                || g.aliases?.some((a) => a.includes(query)),
            );
            if (!hit) {
              const names = games.map((g) => g.title).join('、');
              return `未找到游戏「${query}」。可选：${names}`;
            }
            gameId = hit.id;
          }
          const board = await getGameLeaderboard(gameId, channelKey(message));
          return formatLeaderboard(gameId, board);
        }),
    ),
  );

  return () => {
    for (const d of disposers) d();
  };
}

/** 测试专用 */
export function resetGameRecordsForTests(): void {
  legacyDb = null;
  hostDatabases = new WeakMap();
  hostRegistrations.splice(0);
}
