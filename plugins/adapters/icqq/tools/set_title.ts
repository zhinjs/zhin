import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; user_id: number; title: string; duration?: number }>({
  description: '设置 QQ 群成员的专属头衔',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
    title: z.string().describe('头衔文字'),
    duration: z.number().optional().describe('持续时间(秒)，-1永久').default(-1),
  }),
  platforms: ['icqq'],
  approval: 'always',
  async execute({ endpoint_id, group_id, user_id, title, duration }: { endpoint_id: string; group_id: number; user_id: number; title: string; duration?: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const selfInfo= endpoint.pickMember(group_id,endpoint.uin);
    if(!selfInfo.is_admin && !selfInfo.is_owner) return { success: false, message: '我不是群主或管理员，无法设置头衔' };
    const memberInfo= endpoint.pickMember(group_id,user_id);
    if(!memberInfo) return { success: false, message: '目标成员不存在' };
    await endpoint.setGroupSpecialTitle(group_id, user_id, title, duration ?? -1);
    return { success: true, message: `已将 ${user_id} 的头衔设为 "${title}"` };
  },
});
