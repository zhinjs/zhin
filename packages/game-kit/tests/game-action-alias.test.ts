import { describe, expect, it } from 'vitest';
import {
  gameActionWords,
  normalizeBjAction,
  normalizeChainAction,
  normalizeTttAction,
} from '../src/game-action-alias.js';
import { gameCommandAction, gameCommandMatch } from '../src/command-match.js';

describe('game action tables (#1250 第 82 批)', () => {
  it('normalizes Chinese and English action words to one action', () => {
    expect(normalizeChainAction('开始')).toBe('start_pinyin');
    expect(normalizeTttAction('人机')).toBe('bot');
    expect(normalizeBjAction('')).toBe('help');
    expect(normalizeBjAction('帮助')).toBe('help');
    expect(normalizeBjAction('开始')).toBe('start');
    expect(normalizeBjAction('继续')).toBe('continue');
    expect(normalizeBjAction('退出')).toBe('quit');
    expect(normalizeBjAction('放弃')).toBe('quit');
    expect(normalizeBjAction('要牌')).toBe('hit');
    expect(normalizeBjAction('停牌')).toBe('stand');
    expect(normalizeBjAction('START')).toBe('start');
  });

  it('lists every word a table knows', () => {
    expect(gameActionWords('bj')).toEqual(expect.arrayContaining(['start', '开始', '要牌', '停牌', '退出', '放弃', '帮助']));
    expect(gameActionWords('chain')).toEqual(expect.arrayContaining(['同音', '同字', 'pinyin', 'char']));
    expect(gameActionWords('riddle')).toEqual(expect.arrayContaining(['字谜', '成语']));
  });
});

describe('gameCommandMatch', () => {
  const pattern = gameCommandMatch(['21点', '二十一点'], gameActionWords('bj'));

  it('takes the bare keyword and the keyword with a known action', () => {
    expect(pattern.exec('21点')?.groups?.action).toBeUndefined();
    expect(pattern.exec('二十一点 要牌')?.groups?.action).toBe('要牌');
    expect(pattern.exec('21点   START')?.groups?.action).toBe('START');
  });

  it('leaves ordinary chat alone', () => {
    for (const text of ['二十一点 开会', '21点 开会', '二十一点 开始 吧', '二十一点开始', '晚上 二十一点', '/21点 开始']) {
      expect(pattern.test(text)).toBe(false);
    }
  });

  it('prefers the longest keyword and escapes regex characters', () => {
    const roulette = gameCommandMatch(['轮盘', '轮盘赌'], ['开枪']);
    expect(roulette.test('轮盘赌 开枪')).toBe(true);
    expect(gameCommandMatch(['a.b'], ['x+']).test('aXb x')).toBe(false);
    expect(gameCommandMatch(['a.b'], ['x+']).test('a.b x+')).toBe(true);
    expect(() => gameCommandMatch([], ['x'])).toThrow(TypeError);
  });

  it('reads the action from the route parameter first, then the match', () => {
    expect(gameCommandAction({ params: { action: '开始' } })).toBe('开始');
    expect(gameCommandAction({ params: { action: '' }, match: pattern.exec('21点 要牌')! })).toBe('要牌');
    expect(gameCommandAction({ params: { action: '' }, match: pattern.exec('21点')! })).toBe('');
    expect(gameCommandAction({ params: {} })).toBe('');
  });
});
