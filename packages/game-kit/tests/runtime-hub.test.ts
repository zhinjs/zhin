import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatRuntimeGamesHelp,
  getRuntimeGame,
  getRuntimeGames,
  registerRuntimeGame,
  resetRuntimeGamesForTests,
} from '../src/runtime-hub.js';

describe('runtime-hub', () => {
  beforeEach(() => {
    resetRuntimeGamesForTests();
  });

  afterEach(() => {
    resetRuntimeGamesForTests();
  });

  it('registerRuntimeGame adds game and dispose removes it', () => {
    expect(getRuntimeGames()).toEqual([]);
    const dispose = registerRuntimeGame({
      id: 'guess',
      title: '猜数字',
      icon: '🔢',
      description: 'test',
      commandPrefix: '/猜数',
    });
    expect(getRuntimeGame('guess')?.title).toBe('猜数字');
    expect(getRuntimeGames()).toHaveLength(1);
    dispose();
    expect(getRuntimeGames()).toEqual([]);
  });

  it('getRuntimeGames sorts by id', () => {
    registerRuntimeGame({
      id: 'z-last',
      title: 'Z',
      icon: '🎮',
      description: 'z',
      commandPrefix: '/z',
    });
    registerRuntimeGame({
      id: 'a-first',
      title: 'A',
      icon: '🎮',
      description: 'a',
      commandPrefix: '/a',
    });
    expect(getRuntimeGames().map((g) => g.id)).toEqual(['a-first', 'z-last']);
  });

  it('formatRuntimeGamesHelp shows empty state', () => {
    expect(formatRuntimeGamesHelp()).toContain('暂无已加载的游戏插件');
  });

  it('formatRuntimeGamesHelp lists registered games', () => {
    registerRuntimeGame({
      id: 'guess',
      title: '猜数字',
      icon: '🔢',
      description: '七步猜中',
      commandPrefix: '/猜数',
      quickStart: '开始',
    });
    const text = formatRuntimeGamesHelp();
    expect(text).toContain('猜数字');
    expect(text).toContain('/猜数');
    expect(text).toContain('七步猜中');
  });
});
