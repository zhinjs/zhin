import type { Database, Models, RelatedModel } from '@zhin.js/core';
import {
  BaseSessionService,
  channelKey,
  generateSessionId,
  type GameMessageLike,
  type GameSessionDatabase,
} from '@zhin.js/game-kit';
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

export class SessionService extends BaseSessionService<AdvSessionRow> {
  constructor(db: AdvDatabase) {
    super(db as unknown as GameSessionDatabase<AdvSessionRow>, {
      gameId: 'adv',
      table: 'adv_sessions',
      userFields: ['player_id'],
    });
  }

  async createSession(message: GameMessageLike): Promise<AdvSessionRow> {
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
      step_count: 0,
      updated_at: now,
      created_at: now,
    };
    return this.createRow(row);
  }
}

export function createServices(db: AdvDatabase): GameServices {
  return {
    sessions: new SessionService(db),
    profiles: createProfileService(db),
  };
}
