import { describe, expect, it } from 'vitest';
import {
  isAdvAction,
  isChainAction,
  isDiceAction,
  isGuessAction,
  isRiddleAction,
  isRpsAction,
  isTttAction,
  normalizeChainAction,
  normalizeTttAction,
} from '../src/game-action-alias.js';

describe('game action alias predicates', () => {
  it('已知 action 判定为真', () => {
    expect(isChainAction(normalizeChainAction('开始'))).toBe(true);
    expect(isChainAction('continue')).toBe(true);
    expect(isTttAction(normalizeTttAction('人机'))).toBe(true);
    expect(isAdvAction('start')).toBe(true);
    expect(isRpsAction('quit')).toBe(true);
    expect(isDiceAction('start')).toBe(true);
    expect(isGuessAction('start')).toBe(true);
    expect(isRiddleAction('idiom')).toBe(true);
  });

  it('未知 action（normalize 原样小写返回）判定为假', () => {
    expect(isChainAction(normalizeChainAction('tournament tonight'))).toBe(false);
    expect(isTttAction(normalizeTttAction('is fun'))).toBe(false);
    expect(isChainAction('blah')).toBe(false);
  });
});
