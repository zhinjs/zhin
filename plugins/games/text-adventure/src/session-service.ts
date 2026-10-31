import type { Database, Models, RelatedModel } from '@zhin.js/core';
import {
  BaseSessionService,
  generateSessionId,
  type GamePlayer,
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

  async createSession(message: GamePlayer): Promise<AdvSessionRow> {
    const now = Date.now();
    const id = generateSessionId();
    const row: Omit<AdvSessionRow, 'channel_key' | 'adapter' | 'endpoint' | 'channel_type' | 'channel_id'> = {
      id,
      locale: message.locale ?? 'zh-CN',
      player_id: message.sender.id,
      player_name: message.sender.name?.trim() || message.sender.id,
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
    return this.createRow({ target: message.target, fields: row });
  }
}

export function createServices(db: AdvDatabase): GameServices {
  return {
    sessions: new SessionService(db),
    profiles: createProfileService(db),
  };
}
