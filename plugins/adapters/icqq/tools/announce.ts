import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; content: string }>({
  description: '发送 QQ 群公告（需要管理员权限）',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    content: z.string().describe('公告内容'),
  }),
  adapter: 'icqq',
  permissions: ['role(master,admin,trusted,owner)'],
  async execute({ group_id, content }, context) {
    await context.$client.sendGroupNotice(group_id, content);
    return { success: true, message: '群公告已发送' };
  },
});
