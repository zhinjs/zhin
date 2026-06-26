import { describe, it, expect } from 'vitest';
import { resolveRound, parseMove } from '../src/engine.js';

describe('rps engine', () => {
  it('rock beats scissors', () => {
    expect(resolveRound('rock', 'scissors')).toBe(1);
    expect(resolveRound('scissors', 'rock')).toBe(2);
  });

  it('parses Chinese moves', () => {
    expect(parseMove('石头')).toBe('rock');
    expect(parseMove('布')).toBe('paper');
  });

  it('detects draw', () => {
    expect(resolveRound('paper', 'paper')).toBe(0);
  });
});
