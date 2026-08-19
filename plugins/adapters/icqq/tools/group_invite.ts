import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; user_id: number }>({
  description: '邀请好友加入 QQ 群',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要邀请的 QQ号'),
  }),
  platforms: ['icqq'],
  approval: 'never',
  async execute({ endpoint_id, group_id, user_id }: { endpoint_id: string; group_id: number; user_id: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const groupInfo= endpoint.pickGroup(group_id);
    if(!groupInfo) return { success: false, message: '目标群不存在' };
    const memberInfo= endpoint.pickMember(group_id,user_id);
    if(memberInfo) return { success: false, message: '目标成员已加入群' };
    await endpoint.inviteFriend(group_id, user_id);
    return { success: true, message: `已尝试邀请 ${user_id} 加入群 ${group_id}` };
  },
});
