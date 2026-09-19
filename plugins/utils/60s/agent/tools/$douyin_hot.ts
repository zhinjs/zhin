import { defineAgentTool } from '@zhin.js/tool';
import { sixtySClientToken } from '../../src/client.js';
import { z } from 'zod';

export default defineAgentTool<{ limit?: number }>({
  description: "获取抖音热搜榜",
  inputSchema: z.object({ limit: z.number().optional() }),
  keywords: ["抖音", "热搜", "douyin", "dy"],
  tags: ["热搜", "短视频", "抖音"],
  async execute(input, context) {
    const handler = (await import('../../src/handlers/douyin-hot.js')).default;
    return handler(context.use(sixtySClientToken), input);
  },
});
