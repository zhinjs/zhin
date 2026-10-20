const UINT32_RANGE = 0x1_0000_0000;
const ZERO_STATE_FALLBACK = 0x6d2b79f5;

/**
 * Serializable xorshift32 generator for replayable game simulations.
 * Security-sensitive randomness must continue using secureRandomInt.
 */
export class DeterministicRandom {
  #state: number;

  private constructor(state: number) {
    this.#state = normalizeState(state);
  }

  static fromSeed(seed: string | number): DeterministicRandom {
    return new DeterministicRandom(
      typeof seed === 'number' ? seed : hashSeed(seed),
    );
  }

  static fromState(state: number): DeterministicRandom {
    return new DeterministicRandom(state);
  }

  get state(): number {
    return this.#state;
  }

  nextUint32(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  int(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive)
      || maxExclusive <= 0
      || maxExclusive > UINT32_RANGE) {
      throw new RangeError(
        'maxExclusive must be an integer between 1 and 2^32',
      );
    }
    const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
    let value: number;
    do {
      value = this.nextUint32();
    } while (value >= limit);
    return value % maxExclusive;
  }

  intInclusive(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError('invalid inclusive random range');
    }
    return min + this.int(max - min + 1);
  }

  item<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('cannot choose from an empty array');
    }
    return items[this.int(items.length)] as T;
  }
}

function normalizeState(state: number): number {
  if (!Number.isFinite(state)) throw new RangeError('state must be finite');
  return (state >>> 0) || ZERO_STATE_FALLBACK;
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
