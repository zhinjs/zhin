import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; user_id: number }>({
  description: '踢出 QQ 群中的某个成员',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要踢出的成员 QQ号'),
  }),
  platforms: ['icqq'],
  permissions: ['role(master,admin,trusted,owner)'],
  approval: 'never',
  async execute({ endpoint_id, group_id, user_id }: { endpoint_id: string; group_id: number; user_id: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const selfInfo= endpoint.pickMember(group_id,endpoint.uin);
    if(!selfInfo.is_admin && !selfInfo.is_owner) return { success: false, message: '我不是群主或管理员，无法踢出成员' };
    if(selfInfo.user_id === user_id) return { success: false, message: '我不能踢出自己' };
    const memberInfo= endpoint.pickMember(group_id,user_id);
    if(!memberInfo) return { success: false, message: '目标成员不存在' };
    await endpoint.setGroupKick(group_id, user_id);
    return { success: true, message: `已踢出 ${user_id} 成员` };
  },
});
