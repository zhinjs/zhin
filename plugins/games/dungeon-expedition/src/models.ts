import type { Models } from '@zhin.js/core';

export type DungeonSessionStatus = 'active' | 'completed' | 'aborted';

declare module '@zhin.js/core' {
  interface Models {
    dungeon_sessions: {
      id: string;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      owner_id: string;
      owner_name: string;
      state_json: string;
      phase: string;
      turn: string;
      rng_state: number;
      schema_version: number;
      revision: number;
      processed_actions: string;
      deadline_at: number;
      status: DungeonSessionStatus;
      updated_at: number;
      created_at: number;
    };
  }
}

export type DungeonSessionRow = Models['dungeon_sessions'];

export function defineHostTables(
  database: {
    define(name: string, definition: Record<string, unknown>): void;
  },
): void {
  database.define('dungeon_sessions', {
    id: { type: 'text', primary: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    owner_id: { type: 'text', nullable: false },
    owner_name: { type: 'text', default: '' },
    state_json: { type: 'text', nullable: false },
    phase: { type: 'text', default: 'lobby' },
    turn: { type: 'text', default: '' },
    rng_state: { type: 'integer', default: 1 },
    schema_version: { type: 'integer', default: 1 },
    revision: { type: 'integer', default: 0 },
    processed_actions: { type: 'text', default: '[]' },
    deadline_at: { type: 'integer', default: 0 },
    status: { type: 'text', default: 'active' },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
}
