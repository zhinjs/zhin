import { describe, expect, it } from 'vitest';
import { DeterministicRandom } from '../src/index.js';

describe('DeterministicRandom', () => {
  it('replays the same sequence from the same seed', () => {
    const first = DeterministicRandom.fromSeed('dungeon-42');
    const second = DeterministicRandom.fromSeed('dungeon-42');

    expect(Array.from({ length: 20 }, () => first.int(1000)))
      .toEqual(Array.from({ length: 20 }, () => second.int(1000)));
  });

  it('continues from a persisted state', () => {
    const beforeRestart = DeterministicRandom.fromSeed('recoverable');
    beforeRestart.int(10);
    beforeRestart.int(10);
    const persistedState = beforeRestart.state;
    const expected = Array.from({ length: 10 }, () => beforeRestart.int(100));

    const restored = DeterministicRandom.fromState(persistedState);
    expect(Array.from({ length: 10 }, () => restored.int(100))).toEqual(expected);
  });

  it('validates bounds', () => {
    const random = DeterministicRandom.fromSeed('bounds');
    expect(() => random.int(0)).toThrow(RangeError);
    expect(() => random.int(-1)).toThrow(RangeError);
  });
});
