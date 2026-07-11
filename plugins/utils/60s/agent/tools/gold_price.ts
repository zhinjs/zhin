import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool({
  description: "查询今日黄金价格",
  inputSchema: z.object({}),
  keywords: ["金价", "黄金", "黄金价格", "gold"],
  tags: ["金融", "黄金", "价格"],
  async execute() {
    const handler = (await import('../../tools/gold-price/handler.js')).default;
    return handler();
  },
});
