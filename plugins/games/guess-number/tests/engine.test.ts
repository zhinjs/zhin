import { describe, it, expect } from 'vitest';
import { evaluateGuess } from '../src/engine.js';

describe('guess engine', () => {
  it('detects win and hints', () => {
    expect(evaluateGuess(42, 42)).toBe('win');
    expect(evaluateGuess(42, 10)).toBe('low');
    expect(evaluateGuess(42, 90)).toBe('high');
    expect(evaluateGuess(42, 0)).toBe('invalid');
  });
});
