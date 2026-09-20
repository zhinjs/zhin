import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number }>({
  description: '踢出 QQ 群中的某个成员',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要踢出的成员 QQ号'),
  }),
  adapter: 'icqq',
  permissions: ['role(master,admin,trusted,owner)'],
  approval: 'never',
  async execute({ group_id, user_id }, context) {
    const client = context.$client;
    const selfInfo= client.pickMember(group_id,client.uin);
    if(!selfInfo.is_admin && !selfInfo.is_owner) return { success: false, message: '我不是群主或管理员，无法踢出成员' };
    if(selfInfo.user_id === user_id) return { success: false, message: '我不能踢出自己' };
    const memberInfo= client.pickMember(group_id,user_id);
    if(!memberInfo) return { success: false, message: '目标成员不存在' };
    await client.setGroupKick(group_id, user_id);
    return { success: true, message: `已踢出 ${user_id} 成员` };
  },
});
