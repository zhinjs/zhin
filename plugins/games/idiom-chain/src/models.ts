import type { Models } from '@zhin.js/core';
import type { MatchMode } from './engine.js';

export type ChainSessionStatus = 'active' | 'won' | 'lost' | 'aborted';

declare module '@zhin.js/core' {
  interface Models {
    idiom_chain_sessions: {
      id: string;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      player_id: string;
      player_name: string;
      last_idiom: string;
      next_char: string;
      match_mode: MatchMode;
      used_idioms: string;
      player_score: number;
      bot_score: number;
      streak: number;
      best_streak: number;
      wrong_count: number;
      hints_used: number;
      turn: string;
      status: ChainSessionStatus;
      board_message_id: string;
      updated_at: number;
      created_at: number;
    };
  }
}

export type ChainSessionRow = Models['idiom_chain_sessions'];


export function defineHostTables(
  db: { define: (name: string, definition: Record<string, unknown>) => void },
): void {
  db.define('idiom_chain_sessions', {
    id: { type: 'text', primary: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    player_id: { type: 'text', nullable: false },
    player_name: { type: 'text', default: '' },
    last_idiom: { type: 'text', default: '' },
    next_char: { type: 'text', default: '' },
    match_mode: { type: 'text', default: 'pinyin' },
    used_idioms: { type: 'text', default: '[]' },
    player_score: { type: 'integer', default: 0 },
    bot_score: { type: 'integer', default: 0 },
    streak: { type: 'integer', default: 0 },
    best_streak: { type: 'integer', default: 0 },
    wrong_count: { type: 'integer', default: 0 },
    hints_used: { type: 'integer', default: 0 },
    turn: { type: 'text', default: 'player' },
    status: { type: 'text', default: 'active' },
    board_message_id: { type: 'text', default: '' },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
}
