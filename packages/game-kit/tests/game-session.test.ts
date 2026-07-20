import { describe, it, expect } from 'vitest';
import {
  generateSessionId,
  currentPlayerId,
  isPlayer,
  isPlayerTurn,
  playerNumber,
  nextTurn,
  type TurnBasedSession,
} from '../src/game-session.js';

describe('game-session', () => {
  const mockSession: TurnBasedSession = {
    id: 's123',
    adapter: 'test',
    endpoint: 'ep1',
    channel_type: 'group',
    channel_id: 'g1',
    channel_key: 'test-ep1-group:g1',
    board_message_id: 'm1',
    status: 'active',
    updated_at: Date.now(),
    created_at: Date.now(),
    player_1: 'alice',
    player_2: 'bob',
    player_1_name: 'Alice',
    player_2_name: 'Bob',
    turn: 1,
    winner: 0,
    move_count: 0,
  };

  describe('generateSessionId', () => {
    it('generates unique IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^s[a-z0-9]+$/);
    });
  });

  describe('currentPlayerId', () => {
    it('returns player_1 when turn is 1', () => {
      expect(currentPlayerId({ ...mockSession, turn: 1 })).toBe('alice');
    });

    it('returns player_2 when turn is 2', () => {
      expect(currentPlayerId({ ...mockSession, turn: 2 })).toBe('bob');
    });
  });

  describe('isPlayer', () => {
    it('returns true for players', () => {
      expect(isPlayer(mockSession, 'alice')).toBe(true);
      expect(isPlayer(mockSession, 'bob')).toBe(true);
    });

    it('returns false for non-players', () => {
      expect(isPlayer(mockSession, 'charlie')).toBe(false);
    });
  });

  describe('isPlayerTurn', () => {
    it('returns true when it is the player turn', () => {
      expect(isPlayerTurn({ ...mockSession, turn: 1 }, 'alice')).toBe(true);
      expect(isPlayerTurn({ ...mockSession, turn: 2 }, 'bob')).toBe(true);
    });

    it('returns false when not the player turn', () => {
      expect(isPlayerTurn({ ...mockSession, turn: 1 }, 'bob')).toBe(false);
      expect(isPlayerTurn({ ...mockSession, turn: 2 }, 'alice')).toBe(false);
    });
  });

  describe('playerNumber', () => {
    it('returns 1 for player_1', () => {
      expect(playerNumber(mockSession, 'alice')).toBe(1);
    });

    it('returns 2 for player_2', () => {
      expect(playerNumber(mockSession, 'bob')).toBe(2);
    });

    it('returns null for non-player', () => {
      expect(playerNumber(mockSession, 'charlie')).toBeNull();
    });
  });

  describe('nextTurn', () => {
    it('switches turns', () => {
      expect(nextTurn(1)).toBe(2);
      expect(nextTurn(2)).toBe(1);
    });
  });
});
