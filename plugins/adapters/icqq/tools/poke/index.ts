import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number }>({
  description: '在 QQ 群中对某个成员执行戳一戳互动操作',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要戳的目标成员 QQ号'),
  }),
  adapter: 'icqq',
  approval: 'never',
  async execute({ group_id, user_id }, context) {
    await context.$client.sendGroupPoke(group_id, user_id);
    return { success: true, message: `已戳了戳 ${user_id}` };
  },
});
