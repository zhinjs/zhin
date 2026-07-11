import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getRssAgentDeps } from '../../src/rss-agent-deps.js';

export default defineTool<{ url: string }>({
  description: '预览一个 RSS 源的最新内容',
  inputSchema: z.object({ url: z.string().min(1) }),
  async execute({ url }) {
    if (!url) return '请提供 RSS 源 URL';
    try {
      const { fetchFeed } = getRssAgentDeps();
      const { title, items } = await fetchFeed(url);
      if (items.length === 0) return `${title}: 无内容`;
      return items
        .slice(0, 5)
        .map((item, i) => `${i + 1}. ${item.title}\n   ${item.link}`)
        .join('\n');
    } catch (e) {
      return `解析失败: ${(e as Error).message}`;
    }
  },
});
