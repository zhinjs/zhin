import type { Database, Message, Models, RelatedModel } from '@zhin.js/core';
import { channelKey, generateSessionId, boardMessageMatches } from '@zhin.js/game-kit';
import type { DiceSessionRow } from './models.js';

export type DiceDatabase = Database<unknown, Models, string>;

function getModel(db: DiceDatabase) {
  const model = db.models.get('dice_sessions');
  if (!model) throw new Error('dice_sessions not registered');
  return model as RelatedModel<unknown, Models, 'dice_sessions'>;
}

export class SessionService {
  constructor(private readonly db: DiceDatabase) {}

  async getActiveByChannel(channel: string): Promise<DiceSessionRow | null> {
    const rows = await getModel(this.db).findAll({ channel_key: channel, status: 'active' });
    return rows[0] ?? null;
  }

  async getActiveForUser(channel: string, userId: string): Promise<DiceSessionRow | null> {
    const row = await this.getActiveByChannel(channel);
    if (!row || row.player_id !== userId) return null;
    return row;
  }

  async getById(id: string): Promise<DiceSessionRow | null> {
    return getModel(this.db).findOne({ id });
  }

  async getActiveByBoardMessageId(messageId: string): Promise<DiceSessionRow | null> {
    if (!messageId) return null;
    const rows = await getModel(this.db).findAll({});
    for (const row of rows) {
      if (boardMessageMatches(row.board_message_id ?? '', messageId)) return row;
    }
    return null;
  }

  async createSession(message: Message<any>): Promise<DiceSessionRow> {
    const now = Date.now();
    const row: DiceSessionRow = {
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
      last_player_roll: 0,
      last_bot_roll: 0,
      status: 'active',
      board_message_id: '',
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db).create(row);
    return row;
  }

  async updateSession(id: string, patch: Partial<DiceSessionRow>): Promise<void> {
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

export function createServices(db: DiceDatabase): SessionService {
  return new SessionService(db);
}

