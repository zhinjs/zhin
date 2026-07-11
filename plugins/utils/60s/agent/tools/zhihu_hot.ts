import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool<{ limit?: number }>({
  description: "获取知乎热榜",
  inputSchema: z.object({ limit: z.number().optional() }),
  keywords: ["知乎", "热榜", "zhihu", "zh"],
  tags: ["热搜", "社交", "知乎"],
  async execute(input) {
    const handler = (await import('../../tools/zhihu-hot/handler.js')).default;
    return handler(input);
  },
});
