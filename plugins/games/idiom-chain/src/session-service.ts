import type { Database, Models } from '@zhin.js/core';
import {
  BaseSessionService,
  generateSessionId,
  type GamePlayer,
  type GameSessionDatabase,
} from '@zhin.js/game-kit';
import type { MatchMode } from './engine.js';
import type { ChainSessionRow } from './models.js';

export type ChainDatabase = Database<unknown, Models, string>;

export function parseUsed(value: string | string[] | unknown): Set<string> {
  if (Array.isArray(value)) return new Set(value.filter((x): x is string => typeof x === 'string'));
  if (typeof value !== 'string' || !value) return new Set();
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function serializeUsed(set: Set<string>): string {
  return JSON.stringify([...set]);
}

export class SessionService extends BaseSessionService<ChainSessionRow> {
  constructor(db: ChainDatabase) {
    super(db as unknown as GameSessionDatabase<ChainSessionRow>, {
      gameId: 'chain',
      table: 'idiom_chain_sessions',
      userFields: ['player_id'],
    });
  }

  async createSession(
    message: GamePlayer,
    starter: { text: string; nextChar: string; used: string[]; matchMode: MatchMode },
  ): Promise<ChainSessionRow> {
    const now = Date.now();
    const row: Omit<ChainSessionRow, 'channel_key' | 'adapter' | 'endpoint' | 'channel_type' | 'channel_id'> = {
      id: generateSessionId(),
      locale: message.locale ?? 'zh-CN',
      player_id: message.sender.id,
      player_name: message.sender.name?.trim() || message.sender.id,
      last_idiom: starter.text,
      next_char: starter.nextChar,
      match_mode: starter.matchMode,
      used_idioms: serializeUsed(new Set(starter.used)),
      player_score: 0,
      bot_score: 0,
      streak: 0,
      best_streak: 0,
      wrong_count: 0,
      hints_used: 0,
      turn: 'player',
      status: 'active',
      updated_at: now,
      created_at: now,
    };
    return this.createRow({ target: message.target, fields: row });
  }
}

export function createServices(db: ChainDatabase): SessionService {
  return new SessionService(db);
}
