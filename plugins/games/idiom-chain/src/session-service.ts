import type { Database, Message, Models, RelatedModel } from '@zhin.js/core';
import { channelKey, generateSessionId, boardMessageMatches } from '@zhin.js/game-kit';
import type { MatchMode } from './engine.js';
import type { ChainSessionRow } from './models.js';

export type ChainDatabase = Database<unknown, Models, string>;

function getModel(db: ChainDatabase) {
  const model = db.models.get('idiom_chain_sessions');
  if (!model) throw new Error('idiom_chain_sessions not registered');
  return model as RelatedModel<unknown, Models, 'idiom_chain_sessions'>;
}

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

export class SessionService {
  constructor(private readonly db: ChainDatabase) {}

  async getActiveByChannel(channel: string): Promise<ChainSessionRow | null> {
    const rows = await getModel(this.db).findAll({ channel_key: channel, status: 'active' });
    return rows[0] ?? null;
  }

  async getActiveForUser(channel: string, userId: string): Promise<ChainSessionRow | null> {
    const row = await this.getActiveByChannel(channel);
    if (!row || row.player_id !== userId) return null;
    return row;
  }

  async getById(id: string): Promise<ChainSessionRow | null> {
    return getModel(this.db).findOne({ id });
  }

  async getActiveByBoardMessageId(messageId: string): Promise<ChainSessionRow | null> {
    if (!messageId) return null;
    const rows = await getModel(this.db).findAll({});
    for (const row of rows) {
      if (boardMessageMatches(row.board_message_id ?? '', messageId)) return row;
    }
    return null;
  }

  async createSession(
    message: Message<any>,
    starter: { text: string; nextChar: string; used: string[]; matchMode: MatchMode },
  ): Promise<ChainSessionRow> {
    const now = Date.now();
    const row: ChainSessionRow = {
      id: generateSessionId(),
      adapter: String(message.$adapter),
      endpoint: message.$endpoint,
      channel_type: message.$channel.type,
      channel_id: message.$channel.id,
      channel_key: channelKey(message),
      player_id: message.$sender.id,
      player_name: message.$sender.name?.trim() || message.$sender.id,
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
      board_message_id: '',
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db).create(row);
    return row;
  }

  async updateSession(id: string, patch: Partial<ChainSessionRow>): Promise<void> {
    await getModel(this.db).updateWhere({ id }, { ...patch, updated_at: Date.now() });
  }

  async abortStale(idleMs: number): Promise<number> {
    const cutoff = Date.now() - idleMs;
    const model = getModel(this.db);
    const rows = await model.findAll({ status: 'active' });
    let n = 0;
    for (const row of rows) {
      if (row.updated_at < cutoff) {
        await model.updateWhere({ id: row.id }, { status: 'aborted', updated_at: Date.now() });
        n++;
      }
    }
    return n;
  }
}

export function createServices(db: ChainDatabase): SessionService {
  return new SessionService(db);
}

