import type { Models, Plugin } from 'zhin.js';

export type RiddleSessionStatus = 'active' | 'completed' | 'aborted';

declare module 'zhin.js' {
  interface Models {
    word_riddle_sessions: {
      id: string;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      player_id: string;
      player_name: string;
      mode: string;
      queue: string;
      index: number;
      score: number;
      streak: number;
      best_streak: number;
      hints_used: number;
      wrong_count: number;
      status: RiddleSessionStatus;
      board_message_id: string;
      updated_at: number;
      created_at: number;
    };
  }
}

export type RiddleSessionRow = Models['word_riddle_sessions'];

export function registerModels(plugin: Plugin): void {
  plugin.defineModel('word_riddle_sessions', {
    id: { type: 'text', primary: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    player_id: { type: 'text', nullable: false },
    player_name: { type: 'text', default: '' },
    mode: { type: 'text', default: 'char' },
    queue: { type: 'text', default: '[]' },
    index: { type: 'integer', default: 0 },
    score: { type: 'integer', default: 0 },
    streak: { type: 'integer', default: 0 },
    best_streak: { type: 'integer', default: 0 },
    hints_used: { type: 'integer', default: 0 },
    wrong_count: { type: 'integer', default: 0 },
    status: { type: 'text', default: 'active' },
    board_message_id: { type: 'text', default: '' },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
}
