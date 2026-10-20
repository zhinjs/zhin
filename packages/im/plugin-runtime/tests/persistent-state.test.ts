import { copyJson, type JsonValue } from '../src/persistent-state.js';

describe('persistent state JSON contract', () => {
  it('copies only JSON-safe values without keeping mutable references', () => {
    const original = { target: { id: 'room' }, values: [0, false, null, 'x'] };
    const copy = copyJson(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect((copy as typeof original).target).not.toBe(original.target);
  });

  it.each([NaN, Infinity, -0, undefined, new Date(), { callback: () => undefined }, Array(2),
    Object.defineProperty({}, 'hidden', { value: 'lost' }),
    Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('getter should not execute'); } }),
    { [Symbol('ignored')]: 1 }, Object.assign([1], { ignored: 2 }),
  ].map((value) => ({ value })))('rejects values that JSON.stringify would silently change %#', ({ value }) => {
    expect(() => copyJson(value as JsonValue)).toThrow(/Persistent state/);
  });

  it('rejects array subclasses and inherited or own toJSON without executing them', () => {
    const transform = vi.fn(() => 'changed');
    class LossyArray extends Array { toJSON = transform; }
    class InheritedLossyArray extends Array { toJSON() { return transform(); } }
    const subclass = new InheritedLossyArray(1, 2);
    for (const value of [new LossyArray(1, 2), subclass, Object.assign([1, 2], { toJSON: transform })]) {
      expect(() => copyJson(value)).toThrow('Persistent state');
    }
    expect(transform).not.toHaveBeenCalled();
    const sparse = [1, 2, 3];
    delete sparse[1];
    expect(() => copyJson(sparse)).toThrow('holes');
    expect(copyJson([0, 1, 2])).toEqual([0, 1, 2]);
  });

  it('rejects cycles and limits UTF-8 bytes rather than characters', () => {
    const cycle: Record<string, JsonValue> = {};
    cycle.self = cycle;
    expect(() => copyJson(cycle)).toThrow('cycles');
    expect(() => copyJson('中'.repeat(30_000))).toThrow('64 KiB');
    expect(copyJson('a'.repeat(65_533))).toHaveLength(65_533);
    expect(() => copyJson('a'.repeat(65_534))).toThrow('64 KiB');
  });
});
