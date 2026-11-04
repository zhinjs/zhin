import type { Database, Models } from '@zhin.js/core';
import {
  BaseSessionService,
  generateSessionId,
  type GamePlayer,
  type GameSessionDatabase,
} from '@zhin.js/game-kit';
import type { BjSessionRow } from './models.js';
import { freshDeck } from './engine.js';

export type BjDatabase = Database<unknown, Models, string>;

export class SessionService extends BaseSessionService<BjSessionRow> {
  constructor(db: BjDatabase) {
    super(db as unknown as GameSessionDatabase<BjSessionRow>, {
      gameId: 'blackjack',
      table: 'bj_sessions',
      userFields: ['player_id'],
      projectOutcomes: (session) => [
        ...(session.status === 'won' || session.status === 'lost'
            || session.status === 'draw'
          ? [{
              userId: session.player_id,
              userName: session.player_name,
              result: session.status,
              score: session.status === 'won' ? 30 : undefined,
            }]
          : []),
      ],
    });
  }

  async createSession(message: GamePlayer): Promise<BjSessionRow> {
    const deck = freshDeck();
    const playerCards = [deck.pop()!, deck.pop()!];
    const dealerCards = [deck.pop()!, deck.pop()!];
    const now = Date.now();
    const row: Omit<BjSessionRow, 'channel_key' | 'adapter' | 'endpoint' | 'channel_type' | 'channel_id'> = {
      id: generateSessionId(),
      locale: message.locale ?? 'zh-CN',
      player_id: message.sender.id,
      player_name: String(message.sender.name ?? message.sender.id),
      deck_json: JSON.stringify(deck),
      player_cards_json: JSON.stringify(playerCards),
      dealer_cards_json: JSON.stringify(dealerCards),
      status: 'active',
      updated_at: now,
      created_at: now,
    };
    return this.createRow({ target: message.target, fields: row });
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
