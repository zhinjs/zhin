import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ limit?: number }>({
  description: "获取微博热搜榜",
  inputSchema: z.object({ limit: z.number().optional() }),
  keywords: ["微博", "热搜", "weibo", "wb"],
  tags: ["热搜", "社交", "微博"],
  async execute(input) {
    const handler = (await import('../../src/handlers/weibo-hot.js')).default;
    return handler(input);
  },
});
