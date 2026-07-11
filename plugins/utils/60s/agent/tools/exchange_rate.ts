import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool<{ from?: string; to?: string }>({
  description: "查询货币汇率",
  inputSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
  keywords: ["汇率", "兑换", "外汇", "exchange", "rate"],
  tags: ["金融", "汇率", "查询"],
  async execute(input) {
    const handler = (await import('../../tools/exchange-rate/handler.js')).default;
    return handler(input);
  },
});
