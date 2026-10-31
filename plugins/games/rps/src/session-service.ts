import type { Database, Models } from '@zhin.js/core';
import {
  BaseSessionService,
  generateSessionId,
  type GamePlayer,
  type GameSessionDatabase,
} from '@zhin.js/game-kit';
import type { RpsSessionRow } from './models.js';

export type RpsDatabase = Database<unknown, Models, string>;

export class SessionService extends BaseSessionService<RpsSessionRow> {
  constructor(db: RpsDatabase) {
    super(db as unknown as GameSessionDatabase<RpsSessionRow>, {
      gameId: 'rps',
      table: 'rps_sessions',
      userFields: ['player_id'],
      projectOutcomes: (session) => session.status === 'won'
        ? [{
            userId: session.player_id,
            userName: session.player_name,
            result: 'won',
            score: session.player_wins * 10,
          }]
        : session.status === 'lost'
          ? [{
              userId: session.player_id,
              userName: session.player_name,
              result: 'lost',
            }]
          : [],
    });
  }

  async createSession(message: GamePlayer): Promise<RpsSessionRow> {
    const now = Date.now();
    const row: Omit<RpsSessionRow, 'channel_key' | 'adapter' | 'endpoint' | 'channel_type' | 'channel_id'> = {
      id: generateSessionId(),
      locale: message.locale ?? 'zh-CN',
      player_id: message.sender.id,
      player_name: message.sender.name?.trim() || message.sender.id,
      player_wins: 0,
      bot_wins: 0,
      round: 0,
      status: 'active',
      updated_at: now,
      created_at: now,
    };
    return this.createRow({ target: message.target, fields: row });
  }
}

export function createServices(db: RpsDatabase): SessionService {
  return new SessionService(db);
}
