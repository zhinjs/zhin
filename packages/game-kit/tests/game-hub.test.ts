import { describe, it, expect } from 'vitest';
import { normalizeAdvAction, normalizeTttAction } from '../src/game-action-alias.js';
import {
  formatHubHelp,
  hubActionChoiceId,
  hubGameChoiceId,
  parseHubChoiceId,
} from '../src/game-hub-menu.js';
import type { RegisteredGame } from '../src/game-hub-feature.js';

function mockGame(partial: Partial<RegisteredGame>): RegisteredGame {
  return {
    id: 'x',
    title: '测试',
    icon: '🎮',
    description: '描述',
    commandPrefix: '测试',
    menus: [],
    runAction: async () => undefined,
    ...partial,
  };
}

describe('game-action-alias', () => {
  it('normalizes Chinese adv actions', () => {
    expect(normalizeAdvAction('开始')).toBe('start');
    expect(normalizeAdvAction('地图')).toBe('map');
    expect(normalizeAdvAction('')).toBe('help');
  });

  it('normalizes Chinese ttt actions', () => {
    expect(normalizeTttAction('人机')).toBe('bot');
    expect(normalizeTttAction('排队')).toBe('join');
  });
});

describe('game-hub-menu', () => {
  it('parses hub choice ids', () => {
    expect(parseHubChoiceId(hubGameChoiceId('ttt'))).toEqual({ kind: 'game', gameId: 'ttt' });
    expect(parseHubChoiceId(hubActionChoiceId('adv', 'start'))).toEqual({
      kind: 'action',
      gameId: 'adv',
      actionId: 'start',
    });
    expect(parseHubChoiceId('back')).toEqual({ kind: 'back' });
  });

  it('formatHubHelp lists registered games', () => {
    const text = formatHubHelp([
      mockGame({ id: 'ttt', title: '井字棋', commandPrefix: '井字棋', quickStart: '人机', aliases: ['ttt'] }),
      mockGame({ id: 'adv', title: '秘境', commandPrefix: '冒险', description: '文字冒险' }),
    ]);
    expect(text).toContain('2** 款游戏');
    expect(text).toContain('井字棋 人机');
    expect(text).toContain('冒险 开始');
    expect(text).not.toContain('猜拳 开始');
  });
});
