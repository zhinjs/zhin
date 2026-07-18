import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ type?: string }>({
  description: "获取一言/每日一句，随机返回一条语句",
  inputSchema: z.object({ type: z.string().optional() }),
  keywords: ["一言", "每日一句", "语录", "名言", "hitokoto"],
  tags: ["语录", "文学", "随机"],
  async execute(input) {
    const handler = (await import('../../src/handlers/hitokoto.js')).default;
    return handler(input);
  },
});
