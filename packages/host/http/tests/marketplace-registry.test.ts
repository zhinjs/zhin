import { describe, expect, it, vi } from 'vitest';
import { MarketplaceDetailCache, isValidNpmPackageName } from '../src/marketplace-registry.js';

describe('isValidNpmPackageName', () => {
  it('accepts plain and scoped npm names only', () => {
    for (const name of ['zhin.js', '@zhin.js/plugin-foo', 'a', 'pkg_name-1.2~x']) {
      expect(isValidNpmPackageName(name), name).toBe(true);
    }
    for (const name of ['', 'Upper', '@scope', '@scope/', 'a/b', '@a/b/c', '.hidden', '_private', 'a b', 'a?b', 'x'.repeat(215)]) {
      expect(isValidNpmPackageName(name), name).toBe(false);
    }
  });
});

describe('MarketplaceDetailCache', () => {
  it('serves cached values until the TTL expires', async () => {
    let now = 0;
    const load = vi.fn(async (name: string) => `${name}@${now}`);
    const cache = new MarketplaceDetailCache({ load, ttlMs: 100, maxEntries: 8, now: () => now });

    expect(await cache.get('a')).toBe('a@0');
    now = 99;
    expect(await cache.get('a')).toBe('a@0');
    now = 100;
    expect(await cache.get('a')).toBe('a@100');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent loads and does not cache failures', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('boom');
      return 'ok';
    });
    const cache = new MarketplaceDetailCache({ load, ttlMs: 100, maxEntries: 8 });

    const results = await Promise.allSettled([cache.get('a'), cache.get('a')]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(load).toHaveBeenCalledTimes(1);

    fail = false;
    expect(await cache.get('a')).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry beyond the size cap', async () => {
    const load = vi.fn(async (name: string) => name);
    const cache = new MarketplaceDetailCache({ load, ttlMs: 1_000, maxEntries: 2 });

    await cache.get('a');
    await cache.get('b');
    await cache.get('c');
    expect(cache.size).toBe(2);
    await cache.get('a');
    expect(load).toHaveBeenCalledTimes(4);
    await cache.get('c');
    expect(load).toHaveBeenCalledTimes(4);
  });
});
