/**
 * SkillFeature 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillFeature, Skill } from '../src/built/skill.js';
import type { Tool } from '../src/types.js';

function makeTool(name: string, desc: string = ''): Tool {
  return {
    name,
    description: desc,
    parameters: { type: 'object', properties: {} },
    execute: async () => '',
  };
}

function makeSkill(overrides: Partial<Skill> & { name: string }): Skill {
  return {
    description: '默认描述',
    tools: [],
    pluginName: overrides.name,
    ...overrides,
  };
}

describe('SkillFeature', () => {
  let feature: SkillFeature;

  beforeEach(() => {
    feature = new SkillFeature();
  });

  describe('add / remove', () => {
    it('应该能添加 Skill', () => {
      const skill = makeSkill({ name: 'weather', description: '天气查询' });
      const dispose = feature.add(skill, 'plugin-weather');

      expect(feature.items).toHaveLength(1);
      expect(feature.byName.get('weather')).toBe(skill);
      expect(feature.size).toBe(1);
    });

    it('dispose 应移除 Skill', () => {
      const skill = makeSkill({ name: 'weather' });
      const dispose = feature.add(skill, 'plugin-weather');

      dispose();
      expect(feature.items).toHaveLength(0);
      expect(feature.byName.has('weather')).toBe(false);
    });

    it('remove 应从 byName 和 items 中移除', () => {
      const skill = makeSkill({ name: 'weather' });
      feature.add(skill, 'plugin-weather');

      feature.remove(skill);
      expect(feature.items).toHaveLength(0);
      expect(feature.byName.has('weather')).toBe(false);
    });
  });

  describe('get / getAll', () => {
    it('按名称获取', () => {
      const skill = makeSkill({ name: 'news' });
      feature.add(skill, 'plugin-news');

      expect(feature.get('news')).toBe(skill);
      expect(feature.get('nonexistent')).toBeUndefined();
    });

    it('获取所有', () => {
      feature.add(makeSkill({ name: 'a' }), 'pa');
      feature.add(makeSkill({ name: 'b' }), 'pb');

      const all = feature.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      feature.add(makeSkill({
        name: 'weather',
        description: '查询天气预报',
        keywords: ['天气', '气温', '温度'],
        tags: ['weather', '生活'],
        tools: [makeTool('get_weather', '获取天气')],
      }), 'plugin-weather');

      feature.add(makeSkill({
        name: 'news',
        description: '获取新闻资讯',
        keywords: ['新闻', '头条', '资讯'],
        tags: ['news', '信息'],
        tools: [makeTool('get_news', '获取新闻')],
      }), 'plugin-news');

      feature.add(makeSkill({
        name: 'music',
        description: '音乐搜索与播放',
        keywords: ['音乐', '歌曲', '播放'],
        tags: ['music', '娱乐'],
        tools: [makeTool('search_music')],
      }), 'plugin-music');
    });

    it('关键词匹配应返回相关 Skill', () => {
      const results = feature.search('今天天气怎么样');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('weather');
    });

    it('标签匹配应返回相关 Skill', () => {
      const results = feature.search('news');
      expect(results.some(s => s.name === 'news')).toBe(true);
    });

    it('无匹配时应返回空数组', () => {
      const results = feature.search('完全无关的内容 xyz');
      expect(results).toHaveLength(0);
    });

    it('maxResults 应限制返回数量', () => {
      // 搜索一个泛化词，可能匹配多个
      const results = feature.search('获取', { maxResults: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('collectAllTools', () => {
    it('应收集所有 Skill 的工具', () => {
      feature.add(makeSkill({
        name: 'a',
        tools: [makeTool('t1'), makeTool('t2')],
      }), 'pa');
      feature.add(makeSkill({
        name: 'b',
        tools: [makeTool('t3')],
      }), 'pb');

      const tools = feature.collectAllTools();
      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.name)).toEqual(['t1', 't2', 't3']);
    });
  });

  describe('toJSON', () => {
    it('应序列化所有 Skill', () => {
      feature.add(makeSkill({
        name: 'test',
        description: '测试技能',
        keywords: ['test'],
        tags: ['t'],
        tools: [makeTool('t1'), makeTool('t2')],
      }), 'plugin-test');

      const json = feature.toJSON();
      expect(json.name).toBe('skill');
      expect(json.icon).toBe('Brain');
      expect(json.count).toBe(1);
      expect(json.items[0]).toMatchObject({
        name: 'test',
        desc: '测试技能',
        toolCount: 2,
        keywords: ['test'],
        tags: ['t'],
      });
    });

    it('按插件名过滤', () => {
      feature.add(makeSkill({ name: 'a' }), 'pa');
      feature.add(makeSkill({ name: 'b' }), 'pb');

      const json = feature.toJSON('pa');
      expect(json.count).toBe(1);
      expect(json.items[0].name).toBe('a');
    });
  });
});
