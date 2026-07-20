import type { Models } from 'zhin.js';

export type DiceSessionStatus = 'active' | 'won' | 'lost' | 'aborted';

declare module 'zhin.js' {
  interface Models {
    dice_sessions: {
      id: string;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      player_id: string;
      player_name: string;
      player_wins: number;
      bot_wins: number;
      round: number;
      last_player_roll: number;
      last_bot_roll: number;
      status: DiceSessionStatus;
      board_message_id: string;
      updated_at: number;
      created_at: number;
    };
  }
}

export type DiceSessionRow = Models['dice_sessions'];


export function defineHostTables(
  db: { define: (name: string, definition: Record<string, unknown>) => void },
): void {
  db.define('dice_sessions', {
    id: { type: 'text', primary: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    player_id: { type: 'text', nullable: false },
    player_name: { type: 'text', default: '' },
    player_wins: { type: 'integer', default: 0 },
    bot_wins: { type: 'integer', default: 0 },
    round: { type: 'integer', default: 0 },
    last_player_roll: { type: 'integer', default: 0 },
    last_bot_roll: { type: 'integer', default: 0 },
    status: { type: 'text', default: 'active' },
    board_message_id: { type: 'text', default: '' },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
}
