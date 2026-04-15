/**
 * Tool Search Cache 测试
 *
 * 测试工具过滤缓存：
 * - 缓存命中
 * - 工具集变化时自动失效
 * - LRU 驱逐
 * - 手动失效
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@zhin.js/logger', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    Logger: class {
      debug = vi.fn();
      info = vi.fn();
      warn = vi.fn();
      error = vi.fn();
    },
  };
});

import { CachedToolFilter, computeToolSetHash } from '../src/tool-search-cache.js';
import type { AgentTool } from '../src/types.js';

const makeTool = (name: string, description: string, keywords?: string[]): AgentTool => ({
  name,
  description,
  parameters: { type: 'object' },
  execute: async () => 'ok',
  keywords,
});

describe('computeToolSetHash', () => {
  it('should generate consistent hash for same tools', () => {
    const tools = [makeTool('a', 'desc a'), makeTool('b', 'desc b')];
    const hash1 = computeToolSetHash(tools);
    const hash2 = computeToolSetHash(tools);
    expect(hash1).toBe(hash2);
  });

  it('should generate same hash regardless of order', () => {
    const tools1 = [makeTool('a', 'desc a'), makeTool('b', 'desc b')];
    const tools2 = [makeTool('b', 'desc b'), makeTool('a', 'desc a')];
    expect(computeToolSetHash(tools1)).toBe(computeToolSetHash(tools2));
  });

  it('should generate different hash for different tools', () => {
    const tools1 = [makeTool('a', 'desc a')];
    const tools2 = [makeTool('b', 'desc b')];
    expect(computeToolSetHash(tools1)).not.toBe(computeToolSetHash(tools2));
  });
});

describe('CachedToolFilter', () => {
  it('should cache filter results', () => {
    const filter = new CachedToolFilter();
    const tools = [
      makeTool('search', 'search the web', ['search', 'web']),
      makeTool('read', 'read a file', ['read', 'file']),
    ];

    const result1 = filter.filter('search the web', tools);
    const result2 = filter.filter('search the web', tools);

    expect(result1).toEqual(result2);
    expect(filter.size).toBe(1); // Only one cache entry
  });

  it('should invalidate cache when tools change', () => {
    const filter = new CachedToolFilter();
    const tools1 = [makeTool('search', 'search the web', ['search'])];
    const tools2 = [
      makeTool('search', 'search the web', ['search']),
      makeTool('read', 'read a file', ['read']),
    ];

    filter.filter('search', tools1);
    expect(filter.size).toBe(1);

    // Tools changed — cache should be cleared
    filter.filter('search', tools2);
    expect(filter.size).toBe(1); // New entry, old one cleared
  });

  it('should support manual invalidation', () => {
    const filter = new CachedToolFilter();
    const tools = [makeTool('search', 'search', ['search'])];

    filter.filter('query', tools);
    expect(filter.size).toBe(1);

    filter.invalidate();
    expect(filter.size).toBe(0);
  });

  it('should differentiate by filter options', () => {
    const filter = new CachedToolFilter();
    const tools = [
      makeTool('search', 'search', ['search']),
      makeTool('read', 'read', ['read']),
    ];

    filter.filter('search', tools, { maxTools: 1 });
    filter.filter('search', tools, { maxTools: 5 });

    expect(filter.size).toBe(2);
  });
});
