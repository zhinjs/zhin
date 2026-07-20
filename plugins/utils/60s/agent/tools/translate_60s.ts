import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ text: string; to?: string }>({
  description: "翻译文本",
  inputSchema: z.object({ text: z.string().min(1), to: z.string().optional() }),
  keywords: ["翻译", "英文", "中文", "日文", "translate", "译"],
  tags: ["工具", "翻译", "语言"],
  async execute(input) {
    const handler = (await import('../../src/handlers/translate.js')).default;
    return handler(input);
  },
});
