/**
 * 内置 Feature 测试
 * DatabaseFeature / PermissionFeature / ComponentFeature
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionFeature, Permissions } from '../src/built/permission.js';
import { ComponentFeature } from '../src/built/component.js';
import type { Message, MessageBase } from '../src/message.js';

// ============================================================================
// PermissionFeature 测试
// ============================================================================

describe('PermissionFeature', () => {
  let feature: PermissionFeature;

  beforeEach(() => {
    feature = new PermissionFeature();
  });

  function makeMessage(overrides: Partial<MessageBase> = {}): Message<any> {
    return {
      $id: '1',
      $adapter: 'test' as any,
      $bot: 'bot1',
      $content: [],
      $raw: '',
      $sender: { id: 'user1', name: 'User' },
      $channel: { id: 'ch1', type: 'group' },
      $timestamp: Date.now(),
      $reply: vi.fn(),
      $recall: vi.fn(),
      ...overrides,
    } as any;
  }

  it('应有正确的元数据', () => {
    expect(feature.name).toBe('permission');
    expect(feature.icon).toBe('Shield');
    expect(feature.desc).toBe('权限');
  });

  it('构造时应注册内置权限检查器', () => {
    // 构造时已注册 adapter(), group(), private(), channel(), user() 检查器
    expect(feature.items.length).toBeGreaterThanOrEqual(5);
  });

  describe('check', () => {
    it('adapter() 匹配应返回 true', async () => {
      const msg = makeMessage({ $adapter: 'qq' as any });
      expect(await feature.check('adapter(qq)', msg)).toBe(true);
    });

    it('adapter() 不匹配应返回 false', async () => {
      const msg = makeMessage({ $adapter: 'qq' as any });
      expect(await feature.check('adapter(discord)', msg)).toBe(false);
    });

    it('group() 匹配应返回 true', async () => {
      const msg = makeMessage({ $channel: { id: 'g1', type: 'group' } });
      expect(await feature.check('group(g1)', msg)).toBe(true);
    });

    it('group(*) 通配应返回 true', async () => {
      const msg = makeMessage({ $channel: { id: 'g123', type: 'group' } });
      expect(await feature.check('group(*)', msg)).toBe(true);
    });

    it('private() 匹配应返回 true', async () => {
      const msg = makeMessage({ $channel: { id: 'p1', type: 'private' } });
      expect(await feature.check('private(p1)', msg)).toBe(true);
    });

    it('user() 匹配应返回 true', async () => {
      const msg = makeMessage({ $sender: { id: 'u1', name: 'U' } });
      expect(await feature.check('user(u1)', msg)).toBe(true);
    });

    it('user() 不匹配应返回 false', async () => {
      const msg = makeMessage({ $sender: { id: 'u1', name: 'U' } });
      expect(await feature.check('user(u2)', msg)).toBe(false);
    });

    it('未注册的权限名应返回 false', async () => {
      const msg = makeMessage();
      expect(await feature.check('unknown_permission', msg)).toBe(false);
    });
  });

  describe('自定义权限', () => {
    it('应能添加自定义权限检查器', async () => {
      const perm = Permissions.define('admin', (_name, msg) => {
        return msg.$sender.id === 'admin_user';
      });

      feature.add(perm, 'test-plugin');

      const adminMsg = makeMessage({ $sender: { id: 'admin_user', name: 'Admin' } });
      const normalMsg = makeMessage({ $sender: { id: 'normal_user', name: 'Normal' } });

      expect(await feature.check('admin', adminMsg)).toBe(true);
      expect(await feature.check('admin', normalMsg)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('应序列化所有权限', () => {
      const json = feature.toJSON();
      expect(json.name).toBe('permission');
      expect(json.count).toBeGreaterThan(0);
    });

    it('应按插件名过滤', () => {
      feature.add(Permissions.define('custom', () => true), 'my-plugin');
      const json = feature.toJSON('my-plugin');
      expect(json.count).toBe(1);
    });
  });
});

// ============================================================================
// ComponentFeature 测试
// ============================================================================

describe('ComponentFeature', () => {
  let feature: ComponentFeature;

  beforeEach(() => {
    feature = new ComponentFeature();
  });

  const mockComponent = {
    name: 'test-component',
    render: () => ({ type: 'text', data: { text: 'test' } }),
  } as any;

  it('应有正确的元数据', () => {
    expect(feature.name).toBe('component');
    expect(feature.icon).toBe('Box');
    expect(feature.desc).toBe('组件');
  });

  it('add 应添加组件', () => {
    feature.add(mockComponent, 'test-plugin');
    expect(feature.items).toHaveLength(1);
    expect(feature.byName.get('test-component')).toBe(mockComponent);
  });

  it('remove 应移除组件', () => {
    feature.add(mockComponent, 'test-plugin');
    feature.remove(mockComponent);
    expect(feature.items).toHaveLength(0);
    expect(feature.byName.has('test-component')).toBe(false);
  });

  it('get 应按名称获取', () => {
    feature.add(mockComponent, 'test-plugin');
    expect(feature.get('test-component')).toBe(mockComponent);
    expect(feature.get('nonexistent')).toBeUndefined();
  });

  it('getAllNames 应返回所有名称', () => {
    feature.add(mockComponent, 'test-plugin');
    feature.add({ name: 'another', render: () => null } as any, 'test-plugin');
    expect(feature.getAllNames()).toEqual(['test-component', 'another']);
  });

  describe('toJSON', () => {
    it('应返回正确结构', () => {
      feature.add(mockComponent, 'test-plugin');
      const json = feature.toJSON();
      expect(json.name).toBe('component');
      expect(json.count).toBe(1);
      expect(json.items[0]).toEqual({ name: 'test-component', type: 'component' });
    });

    it('按插件名过滤', () => {
      feature.add(mockComponent, 'plugin-a');
      feature.add({ name: 'other', render: () => null } as any, 'plugin-b');
      const json = feature.toJSON('plugin-a');
      expect(json.count).toBe(1);
    });
  });
});

// ============================================================================
// DatabaseFeature 说明
// ============================================================================
// DatabaseFeature 需要实际数据库连接（sqlite3 等），测试跳过。
// 其核心逻辑（add/remove/toJSON）已由 Feature 基类测试覆盖。
// 数据库相关测试见 basic/database/ 目录。
