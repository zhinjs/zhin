/**
 * UserProfileStore 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { UserProfileStore, USER_PROFILE_KEYS } from '../../src/index.js';

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
      expect(summary).toContain('[User profile]');
      expect(summary).toContain('name: 小明');
      expect(summary).toContain('interests: 编程');
    });
  });

  describe('固定维度', () => {
    it('同一维度覆盖写入，别名归一化', async () => {
      await store.set('u1', 'language', 'zh-CN');
      await store.set('u1', 'preferred_language', 'en');
      await store.set('u1', 'Time Zone', 'Asia/Manila');
      expect(await store.getAll('u1')).toEqual({ language: 'en', timezone: 'Asia/Manila' });
    });

    it('拒绝固定维度之外的键、空值与敏感信息，值截断', async () => {
      expect(await store.set('u1', 'favorite_food_2026', '火锅')).toBe(false);
      expect(await store.set('u1', 'name', '   ')).toBe(false);
      expect(await store.set('u1', 'occupation', '我的密码是 hunter2')).toBe(false);
      expect(await store.set('u1', 'interests', 'x'.repeat(200))).toBe(true);
      expect((await store.get('u1', 'interests'))!.length).toBe(80);
      expect(Object.keys(await store.getAll('u1'))).toEqual(['interests']);
    });

    it('无论写多少次，每人最多 8 个维度', async () => {
      for (let i = 0; i < 50; i += 1) {
        for (const key of USER_PROFILE_KEYS) await store.set('u1', key, `v${i}`);
        await store.set('u1', `extra_${i}`, 'x');
      }
      const all = await store.getAll('u1');
      expect(Object.keys(all)).toEqual([...USER_PROFILE_KEYS]);
      expect(all.name).toBe('v49');
    });

    it('旧版本写入的其他键不再注入', async () => {
      const legacy = new UserProfileStore();
      (legacy as any).store.set('u1', 'random_old_key', 'x');
      await legacy.set('u1', 'name', '小明');
      expect(await legacy.buildProfileSummary('u1')).toBe('[User profile]\n- name: 小明');
    });
  });

  it('dispose 应清理数据', async () => {
    await store.set('u1', 'name', '小明');
    store.dispose();
    // dispose 后重新获取，内存实现应清空
    expect(await store.get('u1', 'name')).toBeNull();
  });
});
