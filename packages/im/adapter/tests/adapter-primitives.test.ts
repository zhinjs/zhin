import { describe, expect, it, vi } from 'vitest';
import { InboundDeduper, InboundMessageDeduper, TtlLookupCache } from '../src/index.js';

describe('InboundDeduper', () => {
  it('deduplicates within TTL and allows reprocessing after expiry', () => {
    let clock = 1_000;
    const deduper = new InboundDeduper({ ttlMs: 500, maxEntries: 10, now: () => clock });

    expect(deduper.shouldProcess('msg-1')).toBe(true);
    expect(deduper.has('msg-1')).toBe(true);
    expect(deduper.shouldProcess('msg-1')).toBe(false);

    clock = 1_499;
    expect(deduper.shouldProcess('msg-1')).toBe(false);

    clock = 1_500;
    expect(deduper.has('msg-1')).toBe(false);
    expect(deduper.shouldProcess('msg-1')).toBe(true);
  });

  it('evicts oldest entries when maxEntries is exceeded', () => {
    const deduper = new InboundMessageDeduper({ ttlMs: 10_000, maxEntries: 2 });
    expect(deduper.admit('a')).toBe(true);
    expect(deduper.admit('b')).toBe(true);
    expect(deduper.admit('c')).toBe(true);
    expect(deduper.size).toBe(2);
    expect(deduper.has('a')).toBe(false);
    expect(deduper.has('b')).toBe(true);
    expect(deduper.has('c')).toBe(true);
  });

  it('treats empty or missing keys as non-deduplicated', () => {
    const deduper = new InboundDeduper();
    expect(deduper.shouldProcess('')).toBe(true);
    expect(deduper.shouldProcess(undefined)).toBe(true);
    expect(deduper.shouldProcess(null)).toBe(true);
    expect(deduper.size).toBe(0);
  });
});

describe('TtlLookupCache', () => {
  it('stores entries until TTL expires and enforces maxEntries', () => {
    let clock = 0;
    const cache = new TtlLookupCache<string, number>({
      ttlMs: 100,
      maxEntries: 2,
      now: () => clock,
    });

    cache.set('k1', 1);
    cache.set('k2', 2);
    expect(cache.get('k1')).toBe(1);

    cache.set('k3', 3);
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k2')).toBe(2);
    expect(cache.get('k3')).toBe(3);

    clock = 100;
    expect(cache.get('k2')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('shares in-flight getOrLoad calls, respects cacheWhen, and cleans up on rejection', async () => {
    const cache = new TtlLookupCache<string, string | undefined>({ ttlMs: 1_000 });
    let resolveLoad!: (val: string) => void;
    const loader = vi.fn(() => new Promise<string>((resolve) => { resolveLoad = resolve; }));

    const p1 = cache.getOrLoad('g1', loader);
    const p2 = cache.getOrLoad('g1', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    resolveLoad('owner-1');
    await expect(Promise.all([p1, p2])).resolves.toEqual(['owner-1', 'owner-1']);
    expect(cache.get('g1')).toBe('owner-1');

    // cacheWhen = false should not persist
    const uncached = await cache.getOrLoad('g2', async () => undefined, {
      cacheWhen: (val) => val !== undefined,
    });
    expect(uncached).toBeUndefined();
    expect(cache.get('g2')).toBeUndefined();

    // Error cleans up inflight so subsequent call retries
    let attempts = 0;
    await expect(
      cache.getOrLoad('g3', async () => {
        attempts += 1;
        throw new Error('network error');
      }),
    ).rejects.toThrow('network error');

    await expect(
      cache.getOrLoad('g3', async () => {
        attempts += 1;
        return 'recovered';
      }),
    ).resolves.toBe('recovered');
    expect(attempts).toBe(2);
  });
});
