/**
 * 60s 插件测试
 * 测试 ZhinTool metadata 完整性和工具函数
 */
import { describe, it, expect } from 'vitest';
import { ZhinTool } from '../../../../packages/core/src/built/tool.js';

describe('60s 插件 ZhinTool 定义', () => {
  // 模拟插件中的工具定义
  const newsTool = new ZhinTool('60s_news')
    .desc('获取每日60秒新闻，快速了解今日要闻')
    .tag('新闻', '资讯', '60s')
    .keyword('60s', '新闻', '今日新闻', '60秒', '每日新闻', '读懂世界')
    .alias('新闻', '今日新闻', '60秒')
    .execute(async () => '测试新闻');

  const weatherTool = new ZhinTool('weather')
    .desc('查询指定城市的当前天气信息')
    .tag('天气', '生活', '查询')
    .keyword('天气', '气温', '温度')
    .param('city', { type: 'string', description: '城市名称' }, true)
    .execute(async (args) => `${args.city}: 晴天`);

  describe('工具 metadata 完整性', () => {
    it('60s_news 应有完整 metadata', () => {
      const tool = newsTool.toTool();
      expect(tool.name).toBe('60s_news');
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    });

    it('weather 应有必填参数 city', () => {
      const tool = weatherTool.toTool();
      expect(tool.name).toBe('weather');
      expect(tool.parameters.properties).toHaveProperty('city');
      expect(tool.parameters.required).toContain('city');
    });
  });

  describe('toJSON', () => {
    it('应返回正确的 JSON 结构', () => {
      const json = newsTool.toJSON();
      expect(json.name).toBe('60s_news');
      expect(json.description).toBeTruthy();
      expect(json.parameters).toBeDefined();
      expect(json.tags).toContain('新闻');
    });
  });

  describe('工具执行', () => {
    it('60s_news execute 应返回结果', async () => {
      const tool = newsTool.toTool();
      const result = await tool.execute({});
      expect(result).toBe('测试新闻');
    });

    it('weather execute 应使用参数', async () => {
      const tool = weatherTool.toTool();
      const result = await tool.execute({ city: '北京' });
      expect(result).toBe('北京: 晴天');
    });
  });
});

describe('formatList 工具函数', () => {
  function formatList(items: any[], limit = 10): string {
    return items
      .slice(0, limit)
      .map((item, i) => {
        const title = item.title || item.name || item.word || item;
        const hot = item.hot ? ` 🔥${item.hot}` : '';
        return `${i + 1}. ${title}${hot}`;
      })
      .join('\n');
  }

  it('应格式化列表', () => {
    const items = [
      { title: '热搜1', hot: '100万' },
      { title: '热搜2', hot: '50万' },
    ];
    const result = formatList(items);
    expect(result).toContain('1. 热搜1');
    expect(result).toContain('🔥100万');
    expect(result).toContain('2. 热搜2');
  });

  it('应限制返回数量', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ title: `第${i + 1}条` }));
    const result = formatList(items, 5);
    const lines = result.split('\n');
    expect(lines).toHaveLength(5);
  });

  it('应处理纯字符串数组', () => {
    const items = ['第一条', '第二条'];
    const result = formatList(items);
    expect(result).toContain('1. 第一条');
  });

  it('空数组应返回空字符串', () => {
    expect(formatList([])).toBe('');
  });
});
