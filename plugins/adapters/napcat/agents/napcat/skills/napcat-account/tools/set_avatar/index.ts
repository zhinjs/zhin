import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ file: string }>({
  description: '修改机器人账号的 QQ 头像（仅全局主人可用）。',
  inputSchema: z.object({
    file: z.string().describe('图片（URL 或 base64）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['头像', 'avatar', '设置头像', '换头像'],
  // `file` may be a host path (OneBot reads `file://`), and the avatar is the Bot account's identity.
  permissions: ['owner@global'],
  async execute({ file }: { file: string }, context) {
    const endpoint = context.$client;
      await endpoint.setQQAvatar(file);
      return { success: true };
  },
});
