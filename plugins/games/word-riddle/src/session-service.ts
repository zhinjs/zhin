import type { Database, Models } from '@zhin.js/core';
import {
  BaseSessionService,
  generateSessionId,
  type GamePlayer,
  type GameSessionDatabase,
} from '@zhin.js/game-kit';
import { pickRoundQueue, type RiddleType } from './riddles-catalog.js';
import type { RiddleSessionRow } from './models.js';

export type RiddleDatabase = Database<unknown, Models, string>;

export function parseQueue(value: string | string[] | unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  if (typeof value !== 'string' || !value) return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export class SessionService extends BaseSessionService<RiddleSessionRow> {
  constructor(db: RiddleDatabase) {
    super(db as unknown as GameSessionDatabase<RiddleSessionRow>, {
      gameId: 'riddle',
      table: 'word_riddle_sessions',
      userFields: ['player_id'],
    });
  }

  async createSession(message: GamePlayer, mode: RiddleType): Promise<RiddleSessionRow> {
    const now = Date.now();
    const queue = pickRoundQueue(mode).map((r) => r.id);
    const row: Omit<RiddleSessionRow, 'channel_key' | 'adapter' | 'endpoint' | 'channel_type' | 'channel_id'> = {
      id: generateSessionId(),
      locale: message.locale ?? 'zh-CN',
      player_id: message.sender.id,
      player_name: message.sender.name?.trim() || message.sender.id,
      mode,
      queue: JSON.stringify(queue),
      index: 0,
      score: 0,
      streak: 0,
      best_streak: 0,
      hints_used: 0,
      wrong_count: 0,
      status: 'active',
      updated_at: now,
      created_at: now,
    };
    return this.createRow({ target: message.target, fields: row });
  }
}

export function createServices(db: RiddleDatabase): SessionService {
  return new SessionService(db);
}


export function currentRiddleId(session: RiddleSessionRow): string | null {
  const queue = parseQueue(session.queue);
  return queue[session.index] ?? null;
}
