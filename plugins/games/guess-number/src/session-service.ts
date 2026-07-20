import type { Database, Message, Models, RelatedModel } from '@zhin.js/core';
import { channelKey, generateSessionId } from '@zhin.js/game-kit';
import { MAX, MAX_ATTEMPTS, MIN, newSecret } from './engine.js';
import type { GuessSessionRow } from './models.js';

export type GuessDatabase = Database<unknown, Models, string>;

function getModel(db: GuessDatabase) {
  const model = db.models.get('guess_sessions');
  if (!model) throw new Error('guess_sessions not registered');
  return model as RelatedModel<unknown, Models, 'guess_sessions'>;
}

export class SessionService {
  constructor(private readonly db: GuessDatabase) {}

  async getActiveByChannel(channel: string): Promise<GuessSessionRow | null> {
    const rows = await getModel(this.db).findAll({ channel_key: channel, status: 'active' });
    return rows[0] ?? null;
  }

  async getActiveForUser(channel: string, userId: string): Promise<GuessSessionRow | null> {
    const rows = await getModel(this.db).findAll({
      channel_key: channel,
      player_id: userId,
      status: 'active',
    });
    return rows[0] ?? null;
  }

  async getById(id: string): Promise<GuessSessionRow | null> {
    return getModel(this.db).findOne({ id });
  }

  async createSession(message: Message<any>): Promise<GuessSessionRow> {
    const now = Date.now();
    const row: GuessSessionRow = {
      id: generateSessionId(),
      adapter: String(message.$adapter),
      endpoint: message.$endpoint,
      channel_type: message.$channel.type,
      channel_id: message.$channel.id,
      channel_key: channelKey(message),
      player_id: message.$sender.id,
      player_name: message.$sender.name?.trim() || message.$sender.id,
      secret: newSecret(),
      range_min: MIN,
      range_max: MAX,
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      status: 'active',
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db).create(row);
    return row;
  }

  async updateSession(id: string, patch: Partial<GuessSessionRow>): Promise<void> {
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

export function createServices(db: GuessDatabase): SessionService {
  return new SessionService(db);
}


export function formatStatus(session: GuessSessionRow): string {
  const left = session.max_attempts - session.attempts;
  return [
    '🔢 **猜数字**',
    '',
    `我想了一个 **${session.range_min} ~ ${session.range_max}** 之间的整数。`,
    `你还有 **${left}** 次机会（已猜 ${session.attempts} 次）。`,
    '',
    '直接回复数字即可，例如：`50`',
  ].join('\n');
}
