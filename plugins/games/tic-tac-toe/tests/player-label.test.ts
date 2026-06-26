import { describe, it, expect } from 'vitest';
import {
  BOT_ID,
  formatPlayerWithMark,
  formatRosterLine,
  formatTurnStatus,
  playerDisplayName,
  senderDisplayName,
} from '../src/player-label.js';
import type { TttSessionRow } from '../src/models.js';

const baseSession = {
  id: 's1',
  adapter: 'qq',
  endpoint: 'zhin',
  channel_type: 'group',
  channel_id: 'g1',
  channel_key: 'k1',
  board: '[]',
  turn: 2,
  status: 'active',
  winner: 0,
  board_message_id: '',
  move_count: 1,
  updated_at: 0,
  created_at: 0,
} as TttSessionRow;

describe('player-label', () => {
  it('uses nickname when present', () => {
    expect(senderDisplayName({ id: 'u1', name: '  Alice ' })).toBe('Alice');
  });

  it('falls back to id without nickname', () => {
    expect(senderDisplayName({ id: 'openid-abc' })).toBe('openid-abc');
    expect(playerDisplayName('openid-abc', '')).toBe('openid-abc');
  });

  it('labels bot and roster', () => {
    const session: TttSessionRow = {
      ...baseSession,
      player_x: 'u1',
      player_o: BOT_ID,
      player_x_name: '张三',
      player_o_name: '机器人',
    };
    expect(formatPlayerWithMark('u1', '张三', '✕')).toBe('张三 (✕)');
    expect(formatRosterLine(session)).toBe('张三 (✕) vs 机器人 (○)');
    expect(formatTurnStatus(session, 2)).toBe('第 2 手 · 轮到 机器人 (○)');
  });
});
