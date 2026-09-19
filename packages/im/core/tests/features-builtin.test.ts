/**
 * 内置 Feature 测试
 * DatabaseFeature / ComponentFeature
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFeature } from '../src/built/component.js';

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
