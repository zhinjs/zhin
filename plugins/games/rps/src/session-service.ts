import type { Database, DatabaseFeature, Message, Models, RelatedModel } from 'zhin.js';
import { channelKey, generateSessionId } from '@zhin.js/game-shared';
import type { RpsSessionRow } from './models.js';

export type RpsDatabase = Database<unknown, Models, string>;

function getModel(db: RpsDatabase) {
  const model = db.models.get('rps_sessions');
  if (!model) throw new Error('rps_sessions not registered');
  return model as RelatedModel<unknown, Models, 'rps_sessions'>;
}

export class SessionService {
  constructor(private readonly db: RpsDatabase) {}

  async getActiveByChannel(channel: string): Promise<RpsSessionRow | null> {
    const rows = await getModel(this.db).findAll({ channel_key: channel, status: 'active' });
    return rows[0] ?? null;
  }

  async getActiveForUser(channel: string, userId: string): Promise<RpsSessionRow | null> {
    const row = await this.getActiveByChannel(channel);
    if (!row || row.player_id !== userId) return null;
    return row;
  }

  async getById(id: string): Promise<RpsSessionRow | null> {
    return getModel(this.db).findOne({ id });
  }

  async getActiveByBoardMessageId(messageId: string): Promise<RpsSessionRow | null> {
    if (!messageId) return null;
    const rows = await getModel(this.db).findAll({ status: 'active' });
    for (const row of rows) {
      const stored = row.board_message_id;
      if (!stored) continue;
      if (stored === messageId || stored.endsWith(`:${messageId}`)) return row;
      const tail = stored.split(':').pop();
      if (tail && messageId.endsWith(tail)) return row;
    }
    return null;
  }

  async createSession(message: Message<any>): Promise<RpsSessionRow> {
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
      board_message_id: '',
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db).create(row);
    return row;
  }

  async updateSession(id: string, patch: Partial<RpsSessionRow>): Promise<void> {
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

export function createServices(db: RpsDatabase): SessionService {
  return new SessionService(db);
}

export function resolveGameDatabase(feature: DatabaseFeature): RpsDatabase {
  return feature.db;
}
