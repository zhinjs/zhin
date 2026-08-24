import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_id: number }>({
  description: '获取指定QQ号的用户信息/资料/详情',
  inputSchema: z.object({
    user_id: z.number().describe('目标成员 QQ号'),
  }),
  adapter: 'icqq',
  async execute({ user_id }, context) {
    const profile = await context.$client.getProfile(user_id);
    return { success: true, message: `已获取 ${user_id} 的用户信息:${JSON.stringify(profile,null,2)}` };
  },
});
