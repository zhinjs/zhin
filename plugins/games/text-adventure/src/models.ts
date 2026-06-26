import type { Models, Plugin } from 'zhin.js';

export type AdvSessionStatus = 'active' | 'completed' | 'aborted';

declare module 'zhin.js' {
  interface Models {
    adv_sessions: {
      id: string;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      player_id: string;
      player_name: string;
      scene_id: string;
      hp: number;
      inventory: string;
      flags: string;
      ending_id: string;
      status: AdvSessionStatus;
      board_message_id: string;
      step_count: number;
      updated_at: number;
      created_at: number;
    };
    adv_profiles: {
      player_id: string;
      player_name: string;
      visited_scenes: string;
      endings_seen: string;
      items_found: string;
      achievements: string;
      runs_started: number;
      runs_completed: number;
      total_steps: number;
      best_step_count: number;
      updated_at: number;
      created_at: number;
    };
  }
}

export type AdvSessionRow = Models['adv_sessions'];
export type AdvProfileRow = Models['adv_profiles'];
export type AdvModelName = 'adv_sessions' | 'adv_profiles';

export function registerModels(plugin: Plugin): void {
  plugin.defineModel('adv_sessions', {
    id: { type: 'text', primary: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    player_id: { type: 'text', nullable: false },
    player_name: { type: 'text', default: '' },
    scene_id: { type: 'text', default: 'start' },
    hp: { type: 'integer', default: 100 },
    inventory: { type: 'text', default: '[]' },
    flags: { type: 'text', default: '{}' },
    ending_id: { type: 'text', default: '' },
    status: { type: 'text', default: 'active' },
    board_message_id: { type: 'text', default: '' },
    step_count: { type: 'integer', default: 0 },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });

  plugin.defineModel('adv_profiles', {
    player_id: { type: 'text', primary: true },
    player_name: { type: 'text', default: '' },
    visited_scenes: { type: 'text', default: '[]' },
    endings_seen: { type: 'text', default: '[]' },
    items_found: { type: 'text', default: '[]' },
    achievements: { type: 'text', default: '[]' },
    runs_started: { type: 'integer', default: 0 },
    runs_completed: { type: 'integer', default: 0 },
    total_steps: { type: 'integer', default: 0 },
    best_step_count: { type: 'integer', default: 0 },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
}
