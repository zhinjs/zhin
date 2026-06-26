import type { Models, Plugin } from 'zhin.js';

export type GuessSessionStatus = 'active' | 'won' | 'lost' | 'aborted';

declare module 'zhin.js' {
  interface Models {
    guess_sessions: {
      id: string;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      player_id: string;
      player_name: string;
      secret: number;
      range_min: number;
      range_max: number;
      attempts: number;
      max_attempts: number;
      status: GuessSessionStatus;
      updated_at: number;
      created_at: number;
    };
  }
}

export type GuessSessionRow = Models['guess_sessions'];

export function registerModels(plugin: Plugin): void {
  plugin.defineModel('guess_sessions', {
    id: { type: 'text', primary: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    player_id: { type: 'text', nullable: false },
    player_name: { type: 'text', default: '' },
    secret: { type: 'integer', nullable: false },
    range_min: { type: 'integer', default: 1 },
    range_max: { type: 'integer', default: 100 },
    attempts: { type: 'integer', default: 0 },
    max_attempts: { type: 'integer', default: 7 },
    status: { type: 'text', default: 'active' },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
}
