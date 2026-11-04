import type { Database, Models } from '@zhin.js/core';
import {
  BaseSessionService,
  generateSessionId,
  type GamePlayer,
  type GameSessionDatabase,
} from '@zhin.js/game-kit';
import { MAX, MAX_ATTEMPTS, MIN, newSecret } from './engine.js';
import type { GuessSessionRow } from './models.js';

export type GuessDatabase = Database<unknown, Models, string>;

export class SessionService extends BaseSessionService<GuessSessionRow> {
  constructor(db: GuessDatabase) {
    super(db as unknown as GameSessionDatabase<GuessSessionRow>, {
      gameId: 'guess',
      table: 'guess_sessions',
      userFields: ['player_id'],
      projectOutcomes: (session) => session.status === 'won'
        ? [{
            userId: session.player_id,
            userName: session.player_name,
            result: 'won',
            score: Math.max(
              1,
              session.max_attempts - session.attempts + 1,
            ) * 10,
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

  async createSession(message: GamePlayer): Promise<GuessSessionRow> {
    const now = Date.now();
    const row: Omit<GuessSessionRow, 'channel_key' | 'adapter' | 'endpoint' | 'channel_type' | 'channel_id'> = {
      id: generateSessionId(),
      locale: message.locale ?? 'zh-CN',
      player_id: message.sender.id,
      player_name: message.sender.name?.trim() || message.sender.id,
      secret: newSecret(),
      range_min: MIN,
      range_max: MAX,
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      status: 'active',
      updated_at: now,
      created_at: now,
    };
    return this.createRow({ target: message.target, fields: row });
  }
}

export function createServices(db: GuessDatabase): SessionService {
  return new SessionService(db);
}
