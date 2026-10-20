/**
 * Storage 测试
 *
 * 测试存储后端抽象：
 * - createSwappableBackend: 创建可交换后端
 * - swap: 替换内部后端
 * - get/set/delete/list 委托正确
 * - MemoryStorageBackend 行为
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryStorageBackend,
  createSwappableBackend,
} from '../src/storage.js';

interface TestRecord {
  id: string;
  data: string;
  count?: number;
}

describe('MemoryStorageBackend', () => {
  let backend: MemoryStorageBackend<TestRecord>;

  beforeEach(() => {
    backend = new MemoryStorageBackend<TestRecord>();
  });

  it('should get null for missing key', async () => {
    expect(await backend.get('missing')).toBeNull();
  });

  it('should set and get value', async () => {
    const record: TestRecord = { id: 'k1', data: 'v1' };
    await backend.set('k1', record);
    expect(await backend.get('k1')).toEqual(record);
  });

  it('should overwrite on set', async () => {
    await backend.set('k1', { id: 'k1', data: 'v1' });
    await backend.set('k1', { id: 'k1', data: 'v2' });
    expect(await backend.get('k1')).toEqual({ id: 'k1', data: 'v2' });
  });

  it('should delete and return true for existing key', async () => {
    await backend.set('k1', { id: 'k1', data: 'v1' });
    expect(await backend.delete('k1')).toBe(true);
    expect(await backend.get('k1')).toBeNull();
  });

  it('should return false when deleting non-existent key', async () => {
    expect(await backend.delete('missing')).toBe(false);
  });

  it('should list all values when no filter', async () => {
    await backend.set('k1', { id: 'k1', data: 'v1' });
    await backend.set('k2', { id: 'k2', data: 'v2' });
    const list = await backend.list();
    expect(list).toHaveLength(2);
    expect(list.map(r => r.id).sort()).toEqual(['k1', 'k2']);
  });

  it('should list filtered values', async () => {
    await backend.set('k1', { id: 'k1', data: 'v1', count: 1 });
    await backend.set('k2', { id: 'k2', data: 'v2', count: 1 });
    await backend.set('k3', { id: 'k3', data: 'v3', count: 2 });
    const list = await backend.list({ count: 1 });
    expect(list).toHaveLength(2);
    expect(list.every(r => r.count === 1)).toBe(true);
  });

  it('should clear all data', async () => {
    await backend.set('k1', { id: 'k1', data: 'v1' });
    await backend.set('k2', { id: 'k2', data: 'v2' });
    await backend.clear();
    expect(await backend.get('k1')).toBeNull();
    expect(await backend.get('k2')).toBeNull();
    expect(await backend.list()).toHaveLength(0);
  });

  it('should have type "memory"', () => {
    expect(backend.type).toBe('memory');
  });
});

describe('createSwappableBackend', () => {
  it('should create a backend that delegates to inner backend', async () => {
    const inner = new MemoryStorageBackend<TestRecord>();
    const { backend } = createSwappableBackend(inner);

    await backend.set('k1', { id: 'k1', data: 'v1' });
    expect(await backend.get('k1')).toEqual({ id: 'k1', data: 'v1' });
    expect(await inner.get('k1')).toEqual({ id: 'k1', data: 'v1' });
  });

  it('should return correct shape: backend and swap', () => {
    const inner = new MemoryStorageBackend<TestRecord>();
    const result = createSwappableBackend(inner);
    expect(result).toHaveProperty('backend');
    expect(result).toHaveProperty('swap');
    expect(typeof result.swap).toBe('function');
    expect(result.backend).toBe(inner);
  });
});

describe('swap', () => {
  it('should replace inner backend', async () => {
    const inner1 = new MemoryStorageBackend<TestRecord>();
    const inner2 = new MemoryStorageBackend<TestRecord>();
    const ref = createSwappableBackend(inner1);

    await ref.backend.set('k1', { id: 'k1', data: 'from-inner1' });
    expect(await ref.backend.get('k1')).toEqual({ id: 'k1', data: 'from-inner1' });

    ref.swap(inner2);
    expect(await ref.backend.get('k1')).toBeNull();

    await ref.backend.set('k1', { id: 'k1', data: 'from-inner2' });
    expect(await ref.backend.get('k1')).toEqual({ id: 'k1', data: 'from-inner2' });
    expect(await inner1.get('k1')).toEqual({ id: 'k1', data: 'from-inner1' });
  });
});

describe('swappable backend operations delegation', () => {
  it('get delegates correctly', async () => {
    const inner = new MemoryStorageBackend<TestRecord>();
    await inner.set('k1', { id: 'k1', data: 'v1' });
    const { backend } = createSwappableBackend(inner);
    expect(await backend.get('k1')).toEqual({ id: 'k1', data: 'v1' });
  });

  it('set delegates correctly', async () => {
    const inner = new MemoryStorageBackend<TestRecord>();
    const { backend } = createSwappableBackend(inner);
    await backend.set('k1', { id: 'k1', data: 'v1' });
    expect(await inner.get('k1')).toEqual({ id: 'k1', data: 'v1' });
  });

  it('delete delegates correctly', async () => {
    const inner = new MemoryStorageBackend<TestRecord>();
    await inner.set('k1', { id: 'k1', data: 'v1' });
    const { backend } = createSwappableBackend(inner);
    expect(await backend.delete('k1')).toBe(true);
    expect(await inner.get('k1')).toBeNull();
  });

  it('list delegates correctly', async () => {
    const inner = new MemoryStorageBackend<TestRecord>();
    await inner.set('k1', { id: 'k1', data: 'v1' });
    await inner.set('k2', { id: 'k2', data: 'v2' });
    const { backend } = createSwappableBackend(inner);
    const list = await backend.list();
    expect(list).toHaveLength(2);
  });

  it('list with filter delegates correctly', async () => {
    const inner = new MemoryStorageBackend<TestRecord>();
    await inner.set('k1', { id: 'k1', data: 'v1', count: 1 });
    await inner.set('k2', { id: 'k2', data: 'v2', count: 2 });
    const { backend } = createSwappableBackend(inner);
    const list = await backend.list({ count: 1 });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('k1');
  });

  it('clear delegates correctly', async () => {
    const inner = new MemoryStorageBackend<TestRecord>();
    await inner.set('k1', { id: 'k1', data: 'v1' });
    const { backend } = createSwappableBackend(inner);
    await backend.clear();
    expect(await inner.get('k1')).toBeNull();
  });
});

describe('in-memory fallback behavior', () => {
  it('MemoryStorageBackend is suitable as initial fallback', async () => {
    const memory = new MemoryStorageBackend<TestRecord>();
    const { backend } = createSwappableBackend(memory);

    await backend.set('session-1', { id: 'session-1', data: 'temp' });
    expect(await backend.get('session-1')).not.toBeNull();

    const list = await backend.list();
    expect(list).toHaveLength(1);
  });

  it('swap from memory to another memory backend preserves interface', async () => {
    const mem1 = new MemoryStorageBackend<TestRecord>();
    const mem2 = new MemoryStorageBackend<TestRecord>();
    const ref = createSwappableBackend(mem1);

    await ref.backend.set('k1', { id: 'k1', data: 'v1' });
    ref.swap(mem2);
    await ref.backend.set('k2', { id: 'k2', data: 'v2' });

    expect(await ref.backend.get('k1')).toBeNull();
    expect(await ref.backend.get('k2')).toEqual({ id: 'k2', data: 'v2' });
  });
});

describe('edge cases', () => {
  it('should handle empty string key', async () => {
    const backend = new MemoryStorageBackend<TestRecord>();
    await backend.set('', { id: '', data: 'empty-key' });
    expect(await backend.get('')).toEqual({ id: '', data: 'empty-key' });
  });

  it('should handle list with empty filter object', async () => {
    const backend = new MemoryStorageBackend<TestRecord>();
    await backend.set('k1', { id: 'k1', data: 'v1' });
    const list = await backend.list({});
    expect(list).toHaveLength(1);
  });

  it('should handle multiple filter fields', async () => {
    const backend = new MemoryStorageBackend<TestRecord>();
    await backend.set('k1', { id: 'k1', data: 'v1', count: 1 });
    await backend.set('k2', { id: 'k2', data: 'v1', count: 2 });
    await backend.set('k3', { id: 'k3', data: 'v1', count: 1 });
    const list = await backend.list({ data: 'v1', count: 1 });
    expect(list).toHaveLength(2);
    expect(list.map(r => r.id).sort()).toEqual(['k1', 'k3']);
  });
});
