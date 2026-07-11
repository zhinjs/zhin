import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool<{ province?: string }>({
  description: "查询今日油价",
  inputSchema: z.object({ province: z.string().optional() }),
  keywords: ["油价", "汽油", "柴油", "fuel"],
  tags: ["生活", "油价", "价格"],
  async execute(input) {
    const handler = (await import('../../tools/fuel-price/handler.js')).default;
    return handler(input);
  },
});
