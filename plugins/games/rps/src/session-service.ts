import type { Database, Models } from '@zhin.js/core';
import {
  BaseSessionService,
  channelKey,
  generateSessionId,
  type GameMessageLike,
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

  async createSession(message: GameMessageLike): Promise<RpsSessionRow> {
    const now = Date.now();
    const row: RpsSessionRow = {
      id: generateSessionId(),
      adapter: String(message.$adapter),
      endpoint: message.$endpoint,
      channel_type: message.$channel.type,
      channel_id: message.$channel.id,
      channel_key: channelKey(message),
      player_id: message.$sender.id,
      player_name: message.$sender.name?.trim() || message.$sender.id,
      player_wins: 0,
      bot_wins: 0,
      round: 0,
      status: 'active',
      updated_at: now,
      created_at: now,
    };
    return this.createRow(row);
  }
}

export function createServices(db: RpsDatabase): SessionService {
  return new SessionService(db);
}
