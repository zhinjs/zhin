import { describe, it, expect } from 'vitest';
import { compareRolls } from '../src/engine.js';

describe('dice engine', () => {
  it('compares rolls', () => {
    expect(compareRolls(6, 3)).toBe(1);
    expect(compareRolls(2, 5)).toBe(2);
    expect(compareRolls(4, 4)).toBe(0);
  });
});
