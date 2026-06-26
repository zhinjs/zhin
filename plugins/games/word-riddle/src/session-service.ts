import type { Database, DatabaseFeature, Message, Models, RelatedModel } from 'zhin.js';
import { channelKey, generateSessionId } from '@zhin.js/game-shared';
import { pickRoundQueue, type RiddleType } from './data/riddles.js';
import type { RiddleSessionRow } from './models.js';

export type RiddleDatabase = Database<unknown, Models, string>;

function getModel(db: RiddleDatabase) {
  const model = db.models.get('word_riddle_sessions');
  if (!model) throw new Error('word_riddle_sessions not registered');
  return model as RelatedModel<unknown, Models, 'word_riddle_sessions'>;
}

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

export class SessionService {
  constructor(private readonly db: RiddleDatabase) {}

  async getActiveByChannel(channel: string): Promise<RiddleSessionRow | null> {
    const rows = await getModel(this.db).findAll({ channel_key: channel, status: 'active' });
    return rows[0] ?? null;
  }

  async getActiveForUser(channel: string, userId: string): Promise<RiddleSessionRow | null> {
    const row = await this.getActiveByChannel(channel);
    if (!row || row.player_id !== userId) return null;
    return row;
  }

  async getById(id: string): Promise<RiddleSessionRow | null> {
    return getModel(this.db).findOne({ id });
  }

  async getActiveByBoardMessageId(messageId: string): Promise<RiddleSessionRow | null> {
    if (!messageId) return null;
    const rows = await getModel(this.db).findAll({ status: 'active' });
    for (const row of rows) {
      const stored = row.board_message_id;
      if (!stored) continue;
      if (stored === messageId || stored.endsWith(`:${messageId}`)) return row;
    }
    return null;
  }

  async createSession(message: Message<any>, mode: RiddleType): Promise<RiddleSessionRow> {
    const now = Date.now();
    const queue = pickRoundQueue(mode).map((r) => r.id);
    const row: RiddleSessionRow = {
      id: generateSessionId(),
      adapter: String(message.$adapter),
      endpoint: message.$endpoint,
      channel_type: message.$channel.type,
      channel_id: message.$channel.id,
      channel_key: channelKey(message),
      player_id: message.$sender.id,
      player_name: message.$sender.name?.trim() || message.$sender.id,
      mode,
      queue: JSON.stringify(queue),
      index: 0,
      score: 0,
      streak: 0,
      best_streak: 0,
      hints_used: 0,
      wrong_count: 0,
      status: 'active',
      board_message_id: '',
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db).create(row);
    return row;
  }

  async updateSession(id: string, patch: Partial<RiddleSessionRow>): Promise<void> {
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

export function createServices(db: RiddleDatabase): SessionService {
  return new SessionService(db);
}

export function resolveGameDatabase(feature: DatabaseFeature): RiddleDatabase {
  return feature.db;
}

export function currentRiddleId(session: RiddleSessionRow): string | null {
  const queue = parseQueue(session.queue);
  return queue[session.index] ?? null;
}
