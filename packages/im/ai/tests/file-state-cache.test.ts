/**
 * File State Cache 测试
 *
 * 测试 LRU 文件状态缓存：
 * - 基本 get/set/delete
 * - 路径归一化
 * - LRU 驱逐（条目数）
 * - LRU 驱逐（字节数）
 * - 大文件跳过
 * - clear
 */
import { describe, it, expect } from 'vitest';

import { FileStateCache, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_SIZE_BYTES } from '../src/file-state-cache.js';

const makeState = (content: string) => ({
  content,
  timestamp: Date.now(),
});

describe('FileStateCache', () => {
  it('should store and retrieve file state', () => {
    const cache = new FileStateCache();
    cache.set('/tmp/test.txt', makeState('hello world'));

    const state = cache.get('/tmp/test.txt');
    expect(state).toBeDefined();
    expect(state!.content).toBe('hello world');
  });

  it('should normalize paths', () => {
    const cache = new FileStateCache();
    cache.set('/tmp/./foo/../test.txt', makeState('hello'));

    // Normalized path should be /tmp/test.txt
    const state = cache.get('/tmp/test.txt');
    expect(state).toBeDefined();
    expect(state!.content).toBe('hello');
  });

  it('should return undefined for missing keys', () => {
    const cache = new FileStateCache();
    expect(cache.get('/nonexistent')).toBeUndefined();
  });

  it('should delete entries', () => {
    const cache = new FileStateCache();
    cache.set('/tmp/test.txt', makeState('hello'));
    expect(cache.has('/tmp/test.txt')).toBe(true);

    cache.delete('/tmp/test.txt');
    expect(cache.has('/tmp/test.txt')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('should evict LRU entries when maxEntries is reached', () => {
    const cache = new FileStateCache(3); // Max 3 entries
    cache.set('/a', makeState('a'));
    cache.set('/b', makeState('b'));
    cache.set('/c', makeState('c'));

    expect(cache.size).toBe(3);

    // Adding 4th should evict /a (oldest)
    cache.set('/d', makeState('d'));
    expect(cache.size).toBe(3);
    expect(cache.has('/a')).toBe(false);
    expect(cache.has('/d')).toBe(true);
  });

  it('should update LRU order on get', () => {
    const cache = new FileStateCache(3);
    cache.set('/a', makeState('a'));
    cache.set('/b', makeState('b'));
    cache.set('/c', makeState('c'));

    // Access /a to make it recent
    cache.get('/a');

    // Adding /d should evict /b (now oldest)
    cache.set('/d', makeState('d'));
    expect(cache.has('/a')).toBe(true);
    expect(cache.has('/b')).toBe(false);
  });

  it('should evict by total bytes', () => {
    // Max 200 bytes, 100 entries
    const cache = new FileStateCache(100, 200);
    cache.set('/a', makeState('a'.repeat(40))); // 40 bytes
    cache.set('/b', makeState('b'.repeat(40))); // 40 bytes

    expect(cache.size).toBe(2);

    // Add entries until total exceeds 200 bytes → triggers eviction
    cache.set('/c', makeState('c'.repeat(40)));
    cache.set('/d', makeState('d'.repeat(40)));
    cache.set('/e', makeState('e'.repeat(40)));
    cache.set('/f', makeState('f'.repeat(40))); // 240 total → must evict

    expect(cache.bytes).toBeLessThanOrEqual(200);
  });

  it('should skip caching files larger than 1/4 of maxSizeBytes', () => {
    const cache = new FileStateCache(100, 400);
    // 101 bytes > 400/4 = 100
    cache.set('/big', makeState('x'.repeat(101)));
    expect(cache.has('/big')).toBe(false);
  });

  it('should clear all entries', () => {
    const cache = new FileStateCache();
    cache.set('/a', makeState('a'));
    cache.set('/b', makeState('b'));

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it('should update existing entries', () => {
    const cache = new FileStateCache();
    cache.set('/a', makeState('old'));
    cache.set('/a', makeState('new'));

    expect(cache.size).toBe(1);
    expect(cache.get('/a')!.content).toBe('new');
  });

  it('should export default constants', () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(100);
    expect(DEFAULT_MAX_SIZE_BYTES).toBe(25 * 1024 * 1024);
  });
});
