/**
 * UserProfileStore 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { UserProfileStore } from '../../src/ai/user-profile.js';

describe('UserProfileStore（内存模式）', () => {
  let store: UserProfileStore;

  beforeEach(() => {
    store = new UserProfileStore();
  });

  it('初始 get 应返回 null', async () => {
    expect(await store.get('u1', 'name')).toBeNull();
  });

  it('set 后应能 get', async () => {
    await store.set('u1', 'name', '小明');
    expect(await store.get('u1', 'name')).toBe('小明');
  });

  it('getAll 应返回所有键值', async () => {
    await store.set('u1', 'name', '小明');
    await store.set('u1', 'style', '简洁');
    const all = await store.getAll('u1');
    expect(all).toEqual({ name: '小明', style: '简洁' });
  });

  it('getAll 不存在的用户应返回空对象', async () => {
    expect(await store.getAll('nonexistent')).toEqual({});
  });

  it('delete 已有键应返回 true', async () => {
    await store.set('u1', 'name', '小明');
    const result = await store.delete('u1', 'name');
    expect(result).toBe(true);
    expect(await store.get('u1', 'name')).toBeNull();
  });

  it('delete 不存在的键应返回 false', async () => {
    expect(await store.delete('u1', 'nonexistent')).toBe(false);
  });

  it('不同用户数据应隔离', async () => {
    await store.set('u1', 'name', '小明');
    await store.set('u2', 'name', '小红');
    expect(await store.get('u1', 'name')).toBe('小明');
    expect(await store.get('u2', 'name')).toBe('小红');
  });

  describe('buildProfileSummary', () => {
    it('无数据应返回空字符串', async () => {
      expect(await store.buildProfileSummary('u1')).toBe('');
    });

    it('有数据应生成摘要', async () => {
      await store.set('u1', 'name', '小明');
      await store.set('u1', 'interests', '编程');
      const summary = await store.buildProfileSummary('u1');
      expect(summary).toContain('[用户画像]');
      expect(summary).toContain('name: 小明');
      expect(summary).toContain('interests: 编程');
    });
  });

  it('dispose 应清理数据', async () => {
    await store.set('u1', 'name', '小明');
    store.dispose();
    // dispose 后重新获取，内存实现应清空
    expect(await store.get('u1', 'name')).toBeNull();
  });
});
