import type { Models } from '@zhin.js/core';

export type RouletteSessionStatus = 'active' | 'finished' | 'aborted';

declare module '@zhin.js/core' {
  interface Models {
    roulette_sessions: {
      id: string;
      locale?: 'zh-CN' | 'en' | null;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      /** Exact Endpoint identity (`conversation.endpoint`), used for the mute lookup. */
      endpoint_adapter: string;
      endpoint_id: string;
      host_id: string;
      state_json: string;
      phase: string;
      turn: string;
      revision: number;
      processed_actions: string;
      /** Epoch ms when the lobby or the current turn times out; 0 once the game is over. */
      deadline_at: number;
      status: RouletteSessionStatus;
      updated_at: number;
      created_at: number;
    };
    roulette_group_settings: {
      /** The channel key, one row per group. */
      id: string;
      mute_penalty: number;
      updated_by: string;
      updated_at: number;
    };
  }
}

export type RouletteSessionRow = Models['roulette_sessions'];
export type RouletteGroupSettingsRow = Models['roulette_group_settings'];

export const ROULETTE_TABLES = ['roulette_sessions', 'roulette_group_settings'] as const;

export function defineHostTables(
  database: { define(name: string, definition: Record<string, unknown>, options?: { readonly addColumns?: readonly string[] }): void },
): void {
  database.define('roulette_sessions', {
    id: { type: 'text', primary: true },
    locale: { type: 'text', nullable: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    endpoint_adapter: { type: 'text', default: '' },
    endpoint_id: { type: 'text', default: '' },
    host_id: { type: 'text', nullable: false },
    state_json: { type: 'text', nullable: false },
    phase: { type: 'text', default: 'lobby' },
    turn: { type: 'text', default: '' },
    revision: { type: 'integer', default: 0 },
    processed_actions: { type: 'text', default: '[]' },
    deadline_at: { type: 'bigint', default: 0 },
    status: { type: 'text', default: 'active' },
    updated_at: { type: 'bigint', default: 0 },
    created_at: { type: 'bigint', default: 0 },
  }, { addColumns: ['locale'] });
  database.define('roulette_group_settings', {
    id: { type: 'text', primary: true },
    mute_penalty: { type: 'integer', default: 0 },
    updated_by: { type: 'text', default: '' },
    updated_at: { type: 'bigint', default: 0 },
  });
}
