import type { Database, DatabaseFeature, Message, Models, RelatedModel } from 'zhin.js';
import { channelKey, generateSessionId } from '@zhin.js/game-shared';
import type { BjSessionRow } from './models.js';
import { freshDeck } from './engine.js';

export type BjDatabase = Database<unknown, Models, string>;

function getModel(db: BjDatabase): RelatedModel<unknown, Models, 'bj_sessions'> {
  const model = db.models.get('bj_sessions');
  if (!model) throw new Error('bj_sessions not registered');
  return model as RelatedModel<unknown, Models, 'bj_sessions'>;
}

export function resolveGameDatabase(feature: DatabaseFeature): BjDatabase {
  return feature.db;
}

export class SessionService {
  constructor(private readonly db: BjDatabase) {}

  async createSession(message: Message<any>): Promise<BjSessionRow> {
    const deck = freshDeck();
    const playerCards = [deck.pop()!, deck.pop()!];
    const dealerCards = [deck.pop()!, deck.pop()!];
    const now = Date.now();
    const row: BjSessionRow = {
      id: generateSessionId(),
      adapter: String(message.$adapter),
      endpoint: message.$endpoint,
      channel_type: message.$channel.type,
      channel_id: message.$channel.id,
      channel_key: channelKey(message),
      player_id: message.$sender.id,
      player_name: String(message.$sender.name ?? message.$sender.id),
      deck_json: JSON.stringify(deck),
      player_cards_json: JSON.stringify(playerCards),
      dealer_cards_json: JSON.stringify(dealerCards),
      board_message_id: '',
      status: 'active',
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db).create(row);
    return row;
  }

  async getById(id: string): Promise<BjSessionRow | null> {
    return getModel(this.db).findOne({ id });
  }

  async getActiveForUser(channelKeyValue: string, userId: string): Promise<BjSessionRow | null> {
    const rows = await getModel(this.db).findAll({
      channel_key: channelKeyValue,
      player_id: userId,
      status: 'active',
    });
    return rows[0] ?? null;
  }

  async getActiveByChannel(channelKeyValue: string): Promise<BjSessionRow | null> {
    const rows = await getModel(this.db).findAll({
      channel_key: channelKeyValue,
      status: 'active',
    });
    return rows[0] ?? null;
  }

  async getActiveByBoardMessageId(messageId: string): Promise<BjSessionRow | null> {
    const rows = await getModel(this.db).findAll({
      board_message_id: messageId,
      status: 'active',
    });
    return rows[0] ?? null;
  }

  async updateSession(id: string, patch: Partial<BjSessionRow>): Promise<void> {
    await getModel(this.db).updateWhere({ id }, { ...patch, updated_at: Date.now() });
  }

  async abortStale(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
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

export function createServices(db: BjDatabase): SessionService {
  return new SessionService(db);
}

function parseJsonStringArray(value: string | string[] | unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

export function parseCards(json: string | string[]): string[] {
  return parseJsonStringArray(json);
}

export function parseDeck(json: string | string[]): string[] {
  return parseJsonStringArray(json);
}
