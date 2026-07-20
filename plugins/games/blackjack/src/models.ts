import type { Models } from 'zhin.js';

export type BjSessionStatus = 'active' | 'won' | 'lost' | 'draw' | 'aborted';

declare module 'zhin.js' {
  interface Models {
    bj_sessions: {
      id: string;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      player_id: string;
      player_name: string;
      deck_json: string;
      player_cards_json: string;
      dealer_cards_json: string;
      board_message_id: string;
      status: BjSessionStatus;
      updated_at: number;
      created_at: number;
    };
  }
}

export type BjSessionRow = Models['bj_sessions'];


export function defineHostTables(
  db: { define: (name: string, definition: Record<string, unknown>) => void },
): void {
  db.define('bj_sessions', {
    id: { type: 'text', primary: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    player_id: { type: 'text', nullable: false },
    player_name: { type: 'text', default: '' },
    deck_json: { type: 'text', default: '[]' },
    player_cards_json: { type: 'text', default: '[]' },
    dealer_cards_json: { type: 'text', default: '[]' },
    board_message_id: { type: 'text', default: '' },
    status: { type: 'text', default: 'active' },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
}
