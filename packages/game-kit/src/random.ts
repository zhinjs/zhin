import { randomInt, randomUUID } from 'node:crypto';

export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive must be a positive safe integer');
  }
  return randomInt(maxExclusive);
}

export function secureRandomIntInclusive(min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
    throw new RangeError('invalid inclusive random range');
  }
  return min + randomInt(max - min + 1);
}

export function secureRandomItem<T>(items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('cannot choose from an empty array');
  return items[secureRandomInt(items.length)]!;
}

export function secureShuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export function generateCompactId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${randomUUID().replaceAll('-', '').slice(0, 8)}`;
}
