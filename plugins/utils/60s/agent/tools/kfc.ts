import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool({
  description: "获取 KFC 疯狂星期四文案",
  inputSchema: z.object({}),
  keywords: ["kfc", "KFC", "疯狂星期四", "v50", "肯德基"],
  tags: ["娱乐", "KFC", "文案"],
  async execute() {
    const handler = (await import('../../src/handlers/kfc.js')).default;
    return handler();
  },
});
