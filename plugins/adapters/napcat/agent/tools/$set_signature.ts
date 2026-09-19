import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ signature: string }>({
  description: '设置个人签名（个性签名）。',
  inputSchema: z.object({
    signature: z.string().describe('签名内容'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['签名', '个性签名', 'signature', 'longnick'],
  async execute({ signature }: { signature: string }, context) {
    const endpoint = context.$client;
      await endpoint.setSelfLongnick(signature);
      return { success: true };
  },
});
