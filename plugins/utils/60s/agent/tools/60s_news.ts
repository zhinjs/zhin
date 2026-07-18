import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool({
  description: "获取每日60秒新闻，快速了解今日要闻",
  inputSchema: z.object({}),
  keywords: ["60s", "新闻", "今日新闻", "60秒", "每日新闻", "读懂世界"],
  tags: ["新闻", "资讯", "60s"],
  async execute() {
    const handler = (await import('../../src/handlers/60s-news.js')).default;
    return handler();
  },
});
