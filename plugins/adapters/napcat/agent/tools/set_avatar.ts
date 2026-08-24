import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ file: string }>({
  description: '修改 QQ 头像。',
  inputSchema: z.object({
    file: z.string().describe('图片（URL 或 base64）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['头像', 'avatar', '设置头像', '换头像'],
  async execute({ file }: { file: string }, context) {
    const endpoint = context.$client;
      await endpoint.setQQAvatar(file);
      return { success: true };
  },
});
