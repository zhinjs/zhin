import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ from?: string; to?: string }>({
  description: "查询货币汇率",
  inputSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
  keywords: ["汇率", "兑换", "外汇", "exchange", "rate"],
  tags: ["金融", "汇率", "查询"],
  async execute(input) {
    const handler = (await import('../../src/handlers/exchange-rate.js')).default;
    return handler(input);
  },
});
