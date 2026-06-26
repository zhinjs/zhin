import { describe, it, expect } from 'vitest';
import { checkAnswer } from '../src/engine.js';
import { riddleCount } from '../src/data/riddles.js';

describe('word riddle', () => {
  it('loads open-source char and idiom pools', () => {
    const c = riddleCount();
    expect(c.char).toBeGreaterThanOrEqual(10_000);
    expect(c.idiom).toBeGreaterThanOrEqual(10_000);
  });

  it('checks answers', () => {
    expect(checkAnswer({ id: 'x', type: 'char', question: '', answer: '明' }, '明')).toBe(true);
    expect(checkAnswer({ id: 'x', type: 'char', question: '', answer: '明' }, '朋')).toBe(false);
  });
});
