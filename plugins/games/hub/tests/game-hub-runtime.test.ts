import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import {
  formatRuntimeGamesHelp,
  getRuntimeGame,
  registerRuntimeGame,
  resetRuntimeGamesForTests,
} from '@zhin.js/game-kit';
import plugin from '../plugin.ts';
import gamesCommand from '../commands/games/[action:string=].ts';

const emptyCtx = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => {
    throw new Error('unused');
  },
  args: [] as string[],
  params: {} as Record<string, string | number | boolean>,
  input: undefined as never,
};

describe('@zhin.js/plugin-game-hub runtime', () => {
  beforeEach(() => {
    resetRuntimeGamesForTests();
  });

  afterEach(() => {
    resetRuntimeGamesForTests();
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('game-hub');
  });

  it('brands games command', () => {
    expect(parseCommandDefinition(gamesCommand)).toBe(gamesCommand);
  });

  it('returns empty help when no games are registered', async () => {
    const text = await gamesCommand.execute({ ...emptyCtx, params: {} });
    expect(String(text)).toContain('暂无已加载的游戏插件');
  });

  it('lists registered games and resolves action hint', async () => {
    const dispose = registerRuntimeGame({
      id: 'guess',
      title: '猜数字',
      icon: '🔢',
      description: '1~100 七步猜中神秘数',
      commandPrefix: '/猜数',
      quickStart: '开始',
    });
    try {
      expect(getRuntimeGame('guess')?.title).toBe('猜数字');
      const help = await gamesCommand.execute({ ...emptyCtx, params: {} });
      expect(String(help)).toContain('猜数字');
      expect(String(help)).toContain('/猜数');

      const hint = await gamesCommand.execute({ ...emptyCtx, params: { action: 'guess' } });
      expect(String(hint)).toContain('/猜数 开始');
    } finally {
      dispose();
    }
  });

  it('formatRuntimeGamesHelp matches command default output', async () => {
    registerRuntimeGame({
      id: 'dice',
      title: '骰子对决',
      icon: '🎲',
      description: '掷骰比大小',
      commandPrefix: '/骰子',
    });
    const fromCommand = await gamesCommand.execute({ ...emptyCtx, params: {} });
    expect(String(fromCommand)).toBe(formatRuntimeGamesHelp());
  });

  it('does not let an old generation unregister its replacement', () => {
    const disposePrevious = registerRuntimeGame({
      id: 'guess',
      title: 'old',
      icon: '',
      description: '',
      commandPrefix: '/guess',
    });
    const disposeNext = registerRuntimeGame({
      id: 'guess',
      title: 'next',
      icon: '',
      description: '',
      commandPrefix: '/guess',
    });

    disposePrevious();
    expect(getRuntimeGame('guess')?.title).toBe('next');
    disposeNext();
    expect(getRuntimeGame('guess')).toBeUndefined();
  });

  it('restores the old game when replacement preparation rolls back', () => {
    const disposePrevious = registerRuntimeGame({
      id: 'guess', title: 'old', icon: '', description: '', commandPrefix: '/guess',
    });
    const disposeNext = registerRuntimeGame({
      id: 'guess', title: 'next', icon: '', description: '', commandPrefix: '/guess',
    });

    disposeNext();
    expect(getRuntimeGame('guess')?.title).toBe('old');
    disposePrevious();
  });
});
