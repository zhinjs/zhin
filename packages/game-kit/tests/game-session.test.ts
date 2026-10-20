import { describe, it, expect } from 'vitest';
import { generateSessionId } from '../src/game-session.js';

describe('game-session', () => {
  it('generates unique IDs', () => {
    const id1 = generateSessionId();
    const id2 = generateSessionId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^s[a-z0-9]+$/);
  });
});
