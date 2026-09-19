import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number }>({
  description: 'QQ 群签到/打卡',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
  }),
  adapter: 'icqq',
  approval: 'never',
  async execute({ group_id }, context) {
    const client = context.$client;
    const groupInfo= client.pickGroup(group_id);
    if(!groupInfo) return { success: false, message: '目标群不存在' };
    await client.sendGroupSign(group_id);
    return { success: true, message: '群签到成功' };
  },
});
