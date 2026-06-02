/**
 * Feature 基类测试（从 core/tests/feature.test.ts 迁移）
 */
import { describe, it, expect, vi } from 'vitest';
import { Feature } from '../src/feature.js';
import type { FeatureJSON } from '../src/feature.js';

class TestFeature extends Feature<{ id: string; value: number }> {
  readonly name = 'test';
  readonly icon = 'TestIcon';
  readonly desc = '测试 Feature';

  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(item => ({ id: item.id, value: item.value })),
    };
  }
}

describe('Feature 基类', () => {
  describe('add / remove', () => {
    it('应该能添加 item 并返回 dispose 函数', () => {
      const feature = new TestFeature();
      const item = { id: 'a', value: 1 };
      const dispose = feature.add(item, 'plugin-a');
      expect(feature.items).toHaveLength(1);
      expect(feature.items[0]).toBe(item);
      expect(typeof dispose).toBe('function');
    });

    it('dispose 函数应移除 item', () => {
      const feature = new TestFeature();
      const dispose = feature.add({ id: 'a', value: 1 }, 'plugin-a');
      dispose();
      expect(feature.items).toHaveLength(0);
    });

    it('remove 应返回 true 并移除 item', () => {
      const feature = new TestFeature();
      const item = { id: 'a', value: 1 };
      feature.add(item, 'plugin-a');
      expect(feature.remove(item)).toBe(true);
      expect(feature.items).toHaveLength(0);
    });

    it('remove 不存在的 item 应返回 false', () => {
      const feature = new TestFeature();
      expect(feature.remove({ id: 'x', value: 0 })).toBe(false);
    });

    it('应支持多个 item', () => {
      const feature = new TestFeature();
      feature.add({ id: 'a', value: 1 }, 'plugin-a');
      feature.add({ id: 'b', value: 2 }, 'plugin-b');
      feature.add({ id: 'c', value: 3 }, 'plugin-a');
      expect(feature.items).toHaveLength(3);
      expect(feature.count).toBe(3);
    });
  });

  describe('插件追踪: getByPlugin / countByPlugin', () => {
    it('应按插件名分组 items', () => {
      const feature = new TestFeature();
      feature.add({ id: 'a', value: 1 }, 'plugin-a');
      feature.add({ id: 'b', value: 2 }, 'plugin-b');
      feature.add({ id: 'c', value: 3 }, 'plugin-a');

      const pluginAItems = feature.getByPlugin('plugin-a');
      expect(pluginAItems).toHaveLength(2);
      expect(pluginAItems.map(i => i.id)).toEqual(['a', 'c']);
    });

    it('不存在的插件应返回空数组', () => {
      const feature = new TestFeature();
      expect(feature.getByPlugin('nonexistent')).toEqual([]);
    });

    it('countByPlugin 应返回正确数量', () => {
      const feature = new TestFeature();
      feature.add({ id: 'a', value: 1 }, 'plugin-a');
      feature.add({ id: 'b', value: 2 }, 'plugin-a');
      expect(feature.countByPlugin('plugin-a')).toBe(2);
      expect(feature.countByPlugin('plugin-b')).toBe(0);
    });

    it('remove 应同时从 pluginItems 中移除', () => {
      const feature = new TestFeature();
      const item = { id: 'a', value: 1 };
      feature.add(item, 'plugin-a');
      feature.remove(item);
      expect(feature.getByPlugin('plugin-a')).toHaveLength(0);
    });
  });

  describe('事件监听', () => {
    it('add 时应触发 add 事件', () => {
      const feature = new TestFeature();
      const listener = vi.fn();
      feature.on('add', listener);
      const item = { id: 'a', value: 1 };
      feature.add(item, 'plugin-a');
      expect(listener).toHaveBeenCalledWith(item, 'plugin-a');
    });

    it('remove 时应触发 remove 事件', () => {
      const feature = new TestFeature();
      const listener = vi.fn();
      feature.on('remove', listener);
      const item = { id: 'a', value: 1 };
      feature.add(item, 'plugin-a');
      feature.remove(item, 'plugin-a');
      expect(listener).toHaveBeenCalledWith(item, 'plugin-a');
    });

    it('off 函数应取消监听', () => {
      const feature = new TestFeature();
      const listener = vi.fn();
      const off = feature.on('add', listener);
      off();
      feature.add({ id: 'a', value: 1 }, 'plugin-a');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('toJSON 序列化', () => {
    it('无参数时返回全部 items', () => {
      const feature = new TestFeature();
      feature.add({ id: 'a', value: 1 }, 'plugin-a');
      feature.add({ id: 'b', value: 2 }, 'plugin-b');
      const json = feature.toJSON();
      expect(json.name).toBe('test');
      expect(json.count).toBe(2);
      expect(json.items).toHaveLength(2);
    });

    it('传 pluginName 时只返回该插件的 items', () => {
      const feature = new TestFeature();
      feature.add({ id: 'a', value: 1 }, 'plugin-a');
      feature.add({ id: 'b', value: 2 }, 'plugin-b');
      const json = feature.toJSON('plugin-a');
      expect(json.count).toBe(1);
      expect(json.items[0].id).toBe('a');
    });
  });

  describe('extensions getter', () => {
    it('默认返回空对象', () => {
      expect(new TestFeature().extensions).toEqual({});
    });
  });
});
