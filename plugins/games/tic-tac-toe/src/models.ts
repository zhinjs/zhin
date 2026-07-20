import type { Models } from 'zhin.js';

export type TttSessionStatus = 'active' | 'won' | 'draw' | 'aborted';

declare module 'zhin.js' {
  interface Models {
    ttt_sessions: {
      id: string;
      adapter: string;
      endpoint: string;
      channel_type: string;
      channel_id: string;
      channel_key: string;
      player_x: string;
      player_o: string;
      player_x_name: string;
      player_o_name: string;
      board: string;
      turn: number;
      status: TttSessionStatus;
      winner: number;
      board_message_id: string;
      move_count: number;
      updated_at: number;
      created_at: number;
    };
    ttt_queue: {
      id: number;
      channel_key: string;
      user_id: string;
      user_name: string;
      joined_at: number;
    };
    ttt_moves: {
      id: number;
      session_id: string;
      player_id: string;
      cell: number;
      move_index: number;
      created_at: number;
    };
    ttt_spectators: {
      id: number;
      session_id: string;
      user_id: string;
      joined_at: number;
    };
  }
}

export type TttSessionRow = Models['ttt_sessions'];
export type TttQueueRow = Models['ttt_queue'];
export type TttMoveRow = Models['ttt_moves'];
export type TttSpectatorRow = Models['ttt_spectators'];

/** 井字棋插件注册的表名 */
export type TttModelName = 'ttt_sessions' | 'ttt_queue' | 'ttt_moves' | 'ttt_spectators';


export function defineHostTables(
  db: { define: (name: string, definition: Record<string, unknown>) => void },
): void {
  db.define('ttt_sessions', {
    id: { type: 'text', primary: true },
    adapter: { type: 'text', nullable: false },
    endpoint: { type: 'text', nullable: false },
    channel_type: { type: 'text', nullable: false },
    channel_id: { type: 'text', nullable: false },
    channel_key: { type: 'text', nullable: false },
    player_x: { type: 'text', nullable: false },
    player_o: { type: 'text', nullable: false },
    player_x_name: { type: 'text', default: '' },
    player_o_name: { type: 'text', default: '' },
    board: { type: 'text', default: '[]' },
    turn: { type: 'integer', default: 1 },
    status: { type: 'text', default: 'active' },
    winner: { type: 'integer', default: 0 },
    board_message_id: { type: 'text', default: '' },
    move_count: { type: 'integer', default: 0 },
    updated_at: { type: 'integer', default: 0 },
    created_at: { type: 'integer', default: 0 },
  });
  db.define('ttt_queue', {
    id: { type: 'integer', primary: true },
    channel_key: { type: 'text', nullable: false },
    user_id: { type: 'text', nullable: false },
    user_name: { type: 'text', default: '' },
    joined_at: { type: 'integer', default: 0 },
  });
  db.define('ttt_moves', {
    id: { type: 'integer', primary: true },
    session_id: { type: 'text', nullable: false },
    player_id: { type: 'text', nullable: false },
    cell: { type: 'integer', nullable: false },
    move_index: { type: 'integer', nullable: false },
    created_at: { type: 'integer', default: 0 },
  });
  db.define('ttt_spectators', {
    id: { type: 'integer', primary: true },
    session_id: { type: 'text', nullable: false },
    user_id: { type: 'text', nullable: false },
    joined_at: { type: 'integer', default: 0 },
  });
}
