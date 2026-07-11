import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool<{ limit?: number }>({
  description: "获取抖音热搜榜",
  inputSchema: z.object({ limit: z.number().optional() }),
  keywords: ["抖音", "热搜", "douyin", "dy"],
  tags: ["热搜", "短视频", "抖音"],
  async execute(input) {
    const handler = (await import('../../tools/douyin-hot/handler.js')).default;
    return handler(input);
  },
});
