import { describe, it, expect } from 'vitest';
import { ALL_GAMES, getGameMeta, parseGameId, resolveEnabledGames } from '../src/games/registry.js';

describe('games registry', () => {
  it('has 6 games with required metadata', () => {
    expect(ALL_GAMES).toHaveLength(6);
    for (const g of ALL_GAMES) {
      expect(getGameMeta(g.id).name).toBeTruthy();
      if (g.source === 'fucai') expect(g.fucaiName).toBeTruthy();
      if (g.source === 'ticai') expect(g.ticaiGameNo).toBeTruthy();
    }
  });

  it('parses aliases', () => {
    expect(parseGameId('快乐8')).toBe('kl8');
    expect(parseGameId('双色球')).toBe('ssq');
    expect(parseGameId('大乐透')).toBe('dlt');
    expect(parseGameId('排列5')).toBe('pl5');
    expect(parseGameId('unknown')).toBeNull();
  });

  it('resolves enabled games from config', () => {
    expect(resolveEnabledGames(['kl8', 'ssq']).map((g) => g)).toEqual(['kl8', 'ssq']);
    expect(resolveEnabledGames([]).length).toBe(6);
  });
});
