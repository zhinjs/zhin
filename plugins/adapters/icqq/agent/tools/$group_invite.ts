import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number }>({
  description: '邀请好友加入 QQ 群',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要邀请的 QQ号'),
  }),
  adapter: 'icqq',
  approval: 'never',
  async execute({ group_id, user_id }, context) {
    const client = context.$client;
    const groupInfo= client.pickGroup(group_id);
    if(!groupInfo) return { success: false, message: '目标群不存在' };
    const memberInfo= client.pickMember(group_id,user_id);
    if(memberInfo) return { success: false, message: '目标成员已加入群' };
    await client.inviteFriend(group_id, user_id);
    return { success: true, message: `已尝试邀请 ${user_id} 加入群 ${group_id}` };
  },
});
