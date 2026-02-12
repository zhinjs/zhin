/**
 * Feature 基类测试
 */
import { describe, it, expect } from 'vitest';
import { Feature, FeatureJSON } from '../src/feature.js';

// 创建一个具体的 Feature 子类用于测试
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
  describe('add / remove / getAll', () => {
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
      const item = { id: 'a', value: 1 };
      const dispose = feature.add(item, 'plugin-a');

      dispose();
      expect(feature.items).toHaveLength(0);
    });

    it('remove 应返回 true 并移除 item', () => {
      const feature = new TestFeature();
      const item = { id: 'a', value: 1 };
      feature.add(item, 'plugin-a');

      const result = feature.remove(item);
      expect(result).toBe(true);
      expect(feature.items).toHaveLength(0);
    });

    it('remove 不存在的 item 应返回 false', () => {
      const feature = new TestFeature();
      const result = feature.remove({ id: 'nonexistent', value: 0 });
      expect(result).toBe(false);
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

      const pluginBItems = feature.getByPlugin('plugin-b');
      expect(pluginBItems).toHaveLength(1);
      expect(pluginBItems[0].id).toBe('b');
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

  describe('toJSON 序列化', () => {
    it('无参数时返回全部 items', () => {
      const feature = new TestFeature();
      feature.add({ id: 'a', value: 1 }, 'plugin-a');
      feature.add({ id: 'b', value: 2 }, 'plugin-b');

      const json = feature.toJSON();
      expect(json.name).toBe('test');
      expect(json.icon).toBe('TestIcon');
      expect(json.desc).toBe('测试 Feature');
      expect(json.count).toBe(2);
      expect(json.items).toHaveLength(2);
    });

    it('传 pluginName 时只返回该插件的 items', () => {
      const feature = new TestFeature();
      feature.add({ id: 'a', value: 1 }, 'plugin-a');
      feature.add({ id: 'b', value: 2 }, 'plugin-b');

      const json = feature.toJSON('plugin-a');
      expect(json.count).toBe(1);
      expect(json.items).toHaveLength(1);
      expect(json.items[0].id).toBe('a');
    });
  });

  describe('extensions getter', () => {
    it('默认返回空对象', () => {
      const feature = new TestFeature();
      expect(feature.extensions).toEqual({});
    });
  });
});
