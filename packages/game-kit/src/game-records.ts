import {
  type Database,
  type Models,
  type RelatedModel,
} from '@zhin.js/core';
import { channelKey } from './board-sender.js';
import type { GameMessageLike } from './command-message.js';
import type { HostGameDbSource } from './memory-db.js';
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
export type GameRecordDatabase = Database<unknown, Models, string>;
type GameRecordDb = GameRecordDatabase;

function getRecordModel(database: GameRecordDb): RelatedModel<unknown, Models, 'game_records'> {
  const model = database.models.get('game_records');
  if (!model) throw new Error('game_records not registered');
  return model as RelatedModel<unknown, Models, 'game_records'>;
}

export const GAME_RECORDS_DEFINITION: Record<string, unknown> = Object.freeze({
  id: { type: 'text', primary: true },
  user_id: { type: 'text', nullable: false },
  user_name: { type: 'text', default: '' },
  channel_key: { type: 'text', nullable: false },
  game_id: { type: 'text', nullable: false },
  result: { type: 'text', nullable: false },
  score: { type: 'integer', default: 0 },
  created_at: { type: 'integer', default: 0 },
});

/** Plugin Runtime DatabaseHost 的最小结构（与 @zhin.js/plugin-runtime 的 DatabaseHost 结构对齐） */
export interface GameRecordDatabaseHost extends HostGameDbSource {
  define(name: string, definition: Record<string, unknown>): void;
}

export function defineGameRecordTable(host: GameRecordDatabaseHost): void {
  host.define('game_records', GAME_RECORDS_DEFINITION);
}

function recordId(): string {
  return generateCompactId('gr');
}

/** 对局结束时写入战绩（database 未就绪时静默跳过） */
export interface UserGameStats {
  gameId: string;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  games: number;
}

export interface LeaderboardEntry {
  userId: string;
  userName: string;
  wins: number;
  totalScore: number;
  games: number;
}

export interface GameRecordPort {
  record(
    message: GameMessageLike,
    gameId: string,
    result: GameRecordResult,
    score?: number,
  ): Promise<void>;
  getUserStats(userId: string, channelKeyFilter?: string): Promise<UserGameStats[]>;
  getLeaderboard(gameId: string, channelKeyFilter: string, limit?: number): Promise<LeaderboardEntry[]>;
}

export class GameRecordStore implements GameRecordPort {
  constructor(private readonly database: GameRecordDb) {}

  async record(message: GameMessageLike, gameId: string, result: GameRecordResult, score = 0): Promise<void> {
    await getRecordModel(this.database).create({
      id: recordId(),
      user_id: message.$sender.id,
      user_name: String(message.$sender.name ?? message.$sender.id),
      channel_key: channelKey(message),
      game_id: gameId,
      result,
      score,
      created_at: Date.now(),
    });
  }

  async getUserStats(userId: string, channelKeyFilter?: string): Promise<UserGameStats[]> {
    const where = channelKeyFilter
      ? { user_id: userId, channel_key: channelKeyFilter }
      : { user_id: userId };
    const rows = await getRecordModel(this.database).findAll(where);
    const byGame = new Map<string, UserGameStats>();
    for (const row of rows) {
      const stat = byGame.get(row.game_id) ?? {
        gameId: row.game_id, wins: 0, losses: 0, draws: 0, totalScore: 0, games: 0,
      };
      stat.games++;
      stat.totalScore += row.score;
      if (row.result === 'won') stat.wins++;
      else if (row.result === 'lost') stat.losses++;
      else if (row.result === 'draw') stat.draws++;
      byGame.set(row.game_id, stat);
    }
    return [...byGame.values()].sort((a, b) => b.wins - a.wins);
  }

  async getLeaderboard(gameId: string, channelKeyFilter: string, limit = 10): Promise<LeaderboardEntry[]> {
    const rows = await getRecordModel(this.database).findAll({ game_id: gameId, channel_key: channelKeyFilter });
    const byUser = new Map<string, LeaderboardEntry>();
    for (const row of rows) {
      const entry = byUser.get(row.user_id) ?? {
        userId: row.user_id, userName: row.user_name, wins: 0, totalScore: 0, games: 0,
      };
      entry.games++;
      entry.totalScore += row.score;
      if (row.result === 'won') entry.wins++;
      byUser.set(row.user_id, entry);
    }
    return [...byUser.values()]
      .sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore)
      .slice(0, limit);
  }
}
