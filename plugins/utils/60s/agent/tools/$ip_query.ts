import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ ip?: string }>({
  description: "查询 IP 地址的地理位置信息",
  inputSchema: z.object({ ip: z.string().optional() }),
  keywords: ["ip", "IP", "IP查询", "ip查询"],
  tags: ["网络", "查询", "IP"],
  async execute(input) {
    const handler = (await import('../../src/handlers/ip-query.js')).default;
    return handler(input);
  },
});
