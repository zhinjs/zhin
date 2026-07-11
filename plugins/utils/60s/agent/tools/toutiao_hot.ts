import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool<{ limit?: number }>({
  description: "获取今日头条热搜榜",
  inputSchema: z.object({ limit: z.number().optional() }),
  keywords: ["头条", "今日头条", "热搜", "toutiao", "tt"],
  tags: ["热搜", "资讯", "头条"],
  async execute(input) {
    const handler = (await import('../../tools/toutiao-hot/handler.js')).default;
    return handler(input);
  },
});
