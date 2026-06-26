import type { Database, DatabaseFeature, Message, Models, RelatedModel } from 'zhin.js';
import { channelKey, generateSessionId } from '@zhin.js/game-shared';
import type { AdvModelName, AdvSessionRow } from './models.js';
import { createProfileService, ProfileService } from './profile-service.js';

export type AdvDatabase = Database<unknown, Models, string>;
type AdvModel<K extends AdvModelName> = RelatedModel<unknown, Models, K>;

function getModel<K extends AdvModelName>(db: AdvDatabase, name: K): AdvModel<K> {
  const model = db.models.get(name);
  if (!model) throw new Error(`Model ${name} is not registered`);
  return model as AdvModel<K>;
}

export interface GameServices {
  sessions: SessionService;
  profiles: ProfileService;
}

export class SessionService {
  constructor(private readonly db: AdvDatabase) {}

  async getActiveByChannel(channel: string): Promise<AdvSessionRow | null> {
    const rows = await getModel(this.db, 'adv_sessions').findAll({
      channel_key: channel,
      status: 'active',
    });
    return rows[0] ?? null;
  }

  async getActiveForUser(channel: string, userId: string): Promise<AdvSessionRow | null> {
    const row = await this.getActiveByChannel(channel);
    if (!row || row.player_id !== userId) return null;
    return row;
  }

  async getById(id: string): Promise<AdvSessionRow | null> {
    return getModel(this.db, 'adv_sessions').findOne({ id });
  }

  async getActiveByBoardMessageId(messageId: string): Promise<AdvSessionRow | null> {
    if (!messageId) return null;
    const rows = await getModel(this.db, 'adv_sessions').findAll({ status: 'active' });
    for (const row of rows) {
      const stored = row.board_message_id;
      if (!stored) continue;
      if (stored === messageId) return row;
      if (stored.endsWith(`:${messageId}`)) return row;
      const tail = stored.split(':').pop();
      if (tail && messageId.endsWith(tail)) return row;
    }
    return null;
  }

  async createSession(message: Message<any>): Promise<AdvSessionRow> {
    const now = Date.now();
    const id = generateSessionId();
    const row: AdvSessionRow = {
      id,
      adapter: String(message.$adapter),
      endpoint: message.$endpoint,
      channel_type: message.$channel.type,
      channel_id: message.$channel.id,
      channel_key: channelKey(message),
      player_id: message.$sender.id,
      player_name: message.$sender.name?.trim() || message.$sender.id,
      scene_id: 'start',
      hp: 100,
      inventory: '[]',
      flags: '{}',
      ending_id: '',
      status: 'active',
      board_message_id: '',
      step_count: 0,
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db, 'adv_sessions').create(row);
    return row;
  }

  async updateSession(id: string, patch: Partial<AdvSessionRow>): Promise<void> {
    await getModel(this.db, 'adv_sessions').updateWhere(
      { id },
      { ...patch, updated_at: Date.now() },
    );
  }

  async abortStale(idleMs: number): Promise<number> {
    const cutoff = Date.now() - idleMs;
    const sessions = getModel(this.db, 'adv_sessions');
    const rows = await sessions.findAll({ status: 'active' });
    let n = 0;
    for (const row of rows) {
      if (row.updated_at < cutoff) {
        await sessions.updateWhere({ id: row.id }, { status: 'aborted', updated_at: Date.now() });
        n++;
      }
    }
    return n;
  }
}

export function createServices(db: AdvDatabase): GameServices {
  return {
    sessions: new SessionService(db),
    profiles: createProfileService(db),
  };
}

export function resolveGameDatabase(feature: DatabaseFeature): AdvDatabase {
  return feature.db;
}
