import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ text: string }>({
  description: '英译中翻译。',
  inputSchema: z.object({
    text: z.string().describe('要翻译的英文文本'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['翻译', 'translate', '英译中'],
  async execute({ text }: { text: string }, context) {
    const endpoint = context.$client;
      return endpoint.translateEn2Zh(text);
  },
});
