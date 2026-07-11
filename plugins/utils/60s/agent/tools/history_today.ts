import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool({
  description: "查看历史上的今天发生了什么",
  inputSchema: z.object({}),
  keywords: ["历史", "历史上的今天", "今天历史", "history"],
  tags: ["历史", "知识", "日历"],
  async execute() {
    const handler = (await import('../../tools/history-today/handler.js')).default;
    return handler();
  },
});
