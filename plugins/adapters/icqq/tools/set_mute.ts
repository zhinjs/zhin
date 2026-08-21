import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; user_id: number; duration?: number }>({
  description: '禁言/解除禁言指定成员',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
    duration: z.number().describe('禁言时间(秒)，0=解除禁言').default(0),
  }),
  platforms: ['icqq'],
  approval: 'always',
  async execute({ endpoint_id, group_id, user_id, duration }: { endpoint_id: string; group_id: number; user_id: number; duration?: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const selfInfo= endpoint.pickMember(group_id,endpoint.uin);
    if(!selfInfo.is_admin && !selfInfo.is_owner) return { success: false, message: '我不是群主或管理员，无法禁言/解除禁言成员' };
    const memberInfo= endpoint.pickMember(group_id,user_id);
    if(!memberInfo) return { success: false, message: '目标成员不存在' };
    await endpoint.setGroupBan(group_id, user_id, duration === 0 ? 0 : duration);
    return { success: true, message: `已${duration === 0 ? '解除' : ''}禁言 ${user_id} 成员${duration === 0 ? '' : `(${duration}秒)`}` };
  },
});
