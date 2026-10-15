import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboundDeduper } from '../../src/plugin-runtime/im/inbound-dedup.js';

const conv = (over: Record<string, unknown> = {}, endpointId = 'e1') => ({
  endpoint: { id: endpointId, adapter: 'qq' }, kind: 'group' as const, id: 'g1', ...over,
}) as never;

function setup() {
  let t = 1_000;
  const deduper = new InboundDeduper(() => t);
  return { deduper, advance: (ms: number) => { t += ms; } };
}

describe('InboundDeduper', () => {
  it('first wins across endpoints, others are duplicates', () => {
    const { deduper } = setup();
    expect(deduper.claim(conv(), 'u1', 'm1')).toBe('first');
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm1')).toBe('duplicate');
    expect(deduper.claim(conv({}, 'e3'), 'u1', 'm1')).toBe('duplicate');
  });

  it('same endpoint repeat is same_endpoint and does not replace the winner', () => {
    const { deduper } = setup();
    deduper.claim(conv(), 'u1', 'm1');
    expect(deduper.claim(conv(), 'u1', 'm1')).toBe('same_endpoint');
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm1')).toBe('duplicate');
  });

  it('does not merge different id, sender, group, adapter, thread or channel kind', () => {
    const { deduper } = setup();
    deduper.claim(conv(), 'u1', 'm1');
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm2')).toBe('first');
    expect(deduper.claim(conv({}, 'e2'), 'u2', 'm1')).toBe('first');
    expect(deduper.claim(conv({ id: 'g2' }, 'e2'), 'u1', 'm1')).toBe('first');
    expect(deduper.claim(conv({ endpoint: { id: 'e2', adapter: 'discord' } }), 'u1', 'm1')).toBe('first');
    expect(deduper.claim(conv({ threadId: 't1' }, 'e2'), 'u1', 'm1')).toBe('first');
    expect(deduper.claim(conv({ kind: 'channel' }, 'e2'), 'u1', 'm1')).toBe('first');
  });

  it('is unkeyed for private chats and missing sender or id', () => {
    const { deduper } = setup();
    expect(deduper.claim(conv({ kind: 'private' }), 'u1', 'm1')).toBe('unkeyed');
    expect(deduper.claim(conv({ kind: 'private' }, 'e2'), 'u1', 'm1')).toBe('unkeyed');
    expect(deduper.claim(conv(), '', 'm1')).toBe('unkeyed');
    expect(deduper.claim(conv(), 'u1', undefined)).toBe('unkeyed');
    expect(deduper.claim(conv(), 'u1', '')).toBe('unkeyed');
    expect(deduper.claim(conv(), 'u1', { id: 1 })).toBe('unkeyed');
    expect(deduper.size).toBe(0);
  });

  it('treats numeric and string ids as equal', () => {
    const { deduper } = setup();
    expect(deduper.claim(conv(), 'u1', 42)).toBe('first');
    expect(deduper.claim(conv({}, 'e2'), 'u1', '42')).toBe('duplicate');
  });

  it('expires entries after the TTL', () => {
    const { deduper, advance } = setup();
    deduper.claim(conv(), 'u1', 'm1');
    advance(59_000);
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm1')).toBe('duplicate');
    advance(61_000);
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm1')).toBe('first');
  });

  it('bounds the map by evicting the oldest entries', () => {
    const { deduper } = setup();
    for (let i = 0; i < 2100; i++) deduper.claim(conv(), 'u1', `m${i}`);
    expect(deduper.size).toBe(2000);
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm0')).toBe('first');
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm2099')).toBe('duplicate');
  });

  describe('arbitrate', () => {
    const decision = { target: 'e1', fallbacks: ['e2', 'e3'] };
    const compute = () => decision;

    afterEach(() => { vi.useRealTimers(); });

    it('lets the target copy handle (routed) and later non-target copies are duplicates', () => {
      const { deduper } = setup();
      expect(deduper.arbitrate(conv(), 'u1', 'm1', compute)).toEqual({ kind: 'handle', routed: true });
      expect(deduper.arbitrate(conv({}, 'e2'), 'u1', 'm1', compute)).toEqual({ kind: 'duplicate' });
      expect(deduper.arbitrate(conv({}, 'e3'), 'u1', 'm1', compute)).toEqual({ kind: 'duplicate' });
    });

    it('a non-target copy waits and becomes a duplicate once the target arrives', async () => {
      const { deduper } = setup();
      const waiting = deduper.arbitrate(conv({}, 'e2'), 'u1', 'm1', compute);
      expect(waiting.kind).toBe('wait');
      expect(deduper.arbitrate(conv(), 'u1', 'm1', compute)).toEqual({ kind: 'handle', routed: true });
      await expect((waiting as { settle(): Promise<string> }).settle()).resolves.toBe('duplicate');
    });

    it('takes over after the grace period when the target never arrives, then the late target is a duplicate', async () => {
      vi.useFakeTimers();
      const deduper = new InboundDeduper(() => Date.now(), 2000);
      const waiting = deduper.arbitrate(conv({}, 'e2'), 'u1', 'm1', compute) as { settle(): Promise<string> };
      const outcome = waiting.settle();
      await vi.advanceTimersByTimeAsync(1999);
      let settled = false;
      void outcome.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(outcome).resolves.toBe('handle');
      expect(deduper.arbitrate(conv(), 'u1', 'm1', compute)).toEqual({ kind: 'duplicate' });
      // The taking-over Endpoint redelivering is still handled; others are duplicates.
      expect(deduper.arbitrate(conv({}, 'e2'), 'u1', 'm1', compute)).toEqual({ kind: 'handle', routed: true });
      expect(deduper.arbitrate(conv({}, 'e3'), 'u1', 'm1', compute)).toEqual({ kind: 'duplicate' });
    });

    it('only the highest-priority waiting copy takes over', async () => {
      const deduper = new InboundDeduper(Date.now, 10);
      const e3 = deduper.arbitrate(conv({}, 'e3'), 'u1', 'm1', compute) as { settle(): Promise<string> };
      const e2 = deduper.arbitrate(conv({}, 'e2'), 'u1', 'm1', compute) as { settle(): Promise<string> };
      await expect(Promise.all([e3.settle(), e2.settle()])).resolves.toEqual(['duplicate', 'handle']);
    });

    it('an Endpoint outside the decision waits as the lowest-priority takeover candidate', async () => {
      const deduper = new InboundDeduper(Date.now, 10);
      const outsider = deduper.arbitrate(conv({}, 'outsider'), 'u1', 'm1', compute) as { kind: string; listed: boolean; settle(): Promise<string> };
      expect(outsider.kind).toBe('wait');
      expect(outsider.listed).toBe(false);
      const e3 = deduper.arbitrate(conv({}, 'e3'), 'u1', 'm1', compute) as { listed: boolean; settle(): Promise<string> };
      expect(e3.listed).toBe(true);
      await expect(Promise.all([outsider.settle(), e3.settle()])).resolves.toEqual(['duplicate', 'handle']);
    });

    it('an unlisted Endpoint takes over alone when nobody else shows up, but is a duplicate once the target arrived', async () => {
      const deduper = new InboundDeduper(Date.now, 10);
      const alone = deduper.arbitrate(conv({}, 'outsider'), 'u1', 'm1', compute) as { settle(): Promise<string> };
      await expect(alone.settle()).resolves.toBe('handle');
      expect(deduper.arbitrate(conv(), 'u1', 'm2', compute)).toEqual({ kind: 'handle', routed: true });
      expect(deduper.arbitrate(conv({}, 'outsider'), 'u1', 'm2', compute)).toEqual({ kind: 'duplicate' });
    });

    it('degrades to claim semantics when there is no decision', () => {
      const { deduper } = setup();
      expect(deduper.arbitrate(conv(), 'u1', 'm1', () => undefined)).toEqual({ kind: 'handle', routed: false });
      expect(deduper.arbitrate(conv({}, 'e2'), 'u1', 'm1', compute)).toEqual({ kind: 'duplicate' });
      expect(deduper.arbitrate(conv(), 'u1', 'm1', compute)).toEqual({ kind: 'handle', routed: false });
    });

    it('is unkeyed for private chats and missing sender or id, without calling compute', () => {
      const { deduper } = setup();
      const spy = vi.fn(compute);
      expect(deduper.arbitrate(conv({ kind: 'private' }), 'u1', 'm1', spy)).toEqual({ kind: 'unkeyed' });
      expect(deduper.arbitrate(conv(), '', 'm1', spy)).toEqual({ kind: 'unkeyed' });
      expect(deduper.arbitrate(conv(), 'u1', undefined, spy)).toEqual({ kind: 'unkeyed' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('target redelivery on the same Endpoint is handled again', () => {
      const { deduper } = setup();
      deduper.arbitrate(conv(), 'u1', 'm1', compute);
      expect(deduper.arbitrate(conv(), 'u1', 'm1', compute)).toEqual({ kind: 'handle', routed: true });
    });

    it('computes once per message, including an undefined decision', () => {
      const { deduper } = setup();
      const spy = vi.fn(compute);
      deduper.arbitrate(conv(), 'u1', 'm1', spy);
      deduper.arbitrate(conv({}, 'e2'), 'u1', 'm1', spy);
      deduper.arbitrate(conv({}, 'e3'), 'u1', 'm1', spy);
      expect(spy).toHaveBeenCalledTimes(1);
      const none = vi.fn(() => undefined);
      deduper.arbitrate(conv(), 'u1', 'm2', none);
      deduper.arbitrate(conv({}, 'e2'), 'u1', 'm2', none);
      expect(none).toHaveBeenCalledTimes(1);
    });

    it('recomputes after the TTL', () => {
      const { deduper, advance } = setup();
      const spy = vi.fn(compute);
      deduper.arbitrate(conv(), 'u1', 'm1', spy);
      advance(59_000);
      deduper.arbitrate(conv({}, 'e2'), 'u1', 'm1', spy);
      expect(spy).toHaveBeenCalledTimes(1);
      advance(61_000);
      deduper.arbitrate(conv(), 'u1', 'm1', spy);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('bounds the cache by evicting the oldest, and eviction does not strand a waiting copy', async () => {
      const deduper = new InboundDeduper(Date.now, 60_000);
      const waiting = deduper.arbitrate(conv({}, 'e2'), 'u1', 'first', compute) as { settle(): Promise<string> };
      for (let i = 0; i < 2100; i++) deduper.arbitrate(conv(), 'u1', `m${i}`, compute);
      await expect(waiting.settle()).resolves.toBe('handle');
      const spy = vi.fn(compute);
      deduper.arbitrate(conv(), 'u1', 'm2099', spy);
      expect(spy).not.toHaveBeenCalled();
    });

    it('propagates a throwing compute without caching', () => {
      const { deduper } = setup();
      expect(() => deduper.arbitrate(conv(), 'u1', 'm1', () => { throw new Error('boom'); })).toThrow('boom');
      expect(deduper.arbitrate(conv(), 'u1', 'm1', compute)).toEqual({ kind: 'handle', routed: true });
    });
  });
});
