import { describe, expect, it } from 'vitest';
import { childPluginId, createCapabilitySlot, rootPluginId } from '@zhin.js/plugin-runtime';
import { defineGame, type RuntimeRegisteredGame } from '../src/game-definition.js';
import { GameIndex } from '../src/game-index.js';
import { gameFeatureId } from '../src/provider.js';
import type { GameRecordPort } from '../src/game-records.js';
import type { GameSessionProvider } from '../src/session-coordinator.js';

const records: GameRecordPort = {
  record: async () => undefined,
  getUserStats: async () => [],
  getLeaderboard: async () => [],
};
const sessions: GameSessionProvider = {
  gameId: 'test',
  getActiveForUser: async () => null,
  bindAvailability: () => undefined,
};

function index(...games: RuntimeRegisteredGame[]): GameIndex {
  return new GameIndex(games.map((game) => createCapabilitySlot({
    owner: childPluginId(rootPluginId(), game.id),
    feature: gameFeatureId,
    localName: game.id,
    source: `${game.id}/plugin.ts#setup`,
    origin: 'setup',
    definition: defineGame(game, records, { ...sessions, gameId: game.id }),
  })));
}

describe('GameIndex', () => {
  it('lists games by id and resolves aliases', () => {
    const games = index(
      { id: 'z-last', title: 'Z', icon: '🎮', description: 'z', commandPrefix: '/z' },
      { id: 'a-first', title: 'A', icon: '🎮', description: 'a', commandPrefix: '/a', aliases: ['first'] },
    );
    expect(games.list().map((game) => game.id)).toEqual(['a-first', 'z-last']);
    expect(games.get('first')?.id).toBe('a-first');
  });

  it('exposes immutable metadata without runtime ports', () => {
    const games = index({
      id: 'guess',
      title: 'Guess',
      icon: '🎮',
      description: 'Guess a number',
      commandPrefix: '/guess',
      menus: [{ id: 'start', label: 'Start' }],
    });
    const game = games.get('guess');
    expect(game).toEqual(games.list()[0]);
    expect(game).not.toHaveProperty('records');
    expect(game).not.toHaveProperty('sessions');
    expect(Object.isFrozen(game)).toBe(true);
    expect(Object.isFrozen(game?.menus)).toBe(true);
    expect(Object.isFrozen(game?.menus?.[0])).toBe(true);
  });

  it('formats empty and populated help', () => {
    expect(index().formatHelp()).toContain('暂无已加载的游戏插件');
    const text = index({
      id: 'guess', title: '猜数字', icon: '🔢', description: '七步猜中',
      commandPrefix: '/猜数', quickStart: '开始',
    }).formatHelp();
    expect(text).toContain('猜数字');
    expect(text).toContain('/猜数');
    expect(text).toContain('七步猜中');
  });

  it('rejects duplicate ids and aliases in one generation', () => {
    expect(() => index(
      { id: 'guess', title: 'A', icon: '', description: '', commandPrefix: '/a', aliases: ['play'] },
      { id: 'other', title: 'B', icon: '', description: '', commandPrefix: '/b', aliases: ['play'] },
    )).toThrow('Duplicate Game name');
  });
});
