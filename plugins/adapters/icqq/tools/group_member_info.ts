import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
interface GroupMemberInfoInput {
  endpoint_id: string;
  group_id: number;
  user_id: number;
}

export default defineAgentTool<GroupMemberInfoInput>({
  description: '获取 QQ 群成员信息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
  }),
  platforms: ['icqq'],
  approval: 'never',
  async execute({ endpoint_id, group_id, user_id }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const group = endpoint.pickGroup(group_id);
    if (!group) return { success: false, message: '目标群不存在' };
    const memberInfo = group.pickMember(user_id);
    if (!memberInfo) return { success: false, message: '目标成员不存在' };
    return {
      success: true,
      member: memberInfo,
    };
  },
});
