import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
interface GroupMemberInfoInput {
  group_id: number;
  user_id: number;
}

export default defineAgentTool<GroupMemberInfoInput>({
  description: '获取 QQ 群成员信息',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
  }),
  adapter: 'icqq',
  approval: 'never',
  async execute({ group_id, user_id }, context) {
    const group = context.$client.pickGroup(group_id);
    if (!group) return { success: false, message: '目标群不存在' };
    const memberInfo = group.pickMember(user_id);
    if (!memberInfo) return { success: false, message: '目标成员不存在' };
    return {
      success: true,
      member: memberInfo,
    };
  },
});
