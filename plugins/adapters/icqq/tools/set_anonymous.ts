import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; enable?: boolean }>({
  description: '开启或关闭 QQ 群的匿名聊天功能',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    enable: z.boolean().optional().describe('true=开启，false=关闭，默认 true'),
  }),
  platforms: ['icqq'],
  permissions: ['role(master,trusted,owner,admin)'],
  async execute({ endpoint_id, group_id, enable }: { endpoint_id: string; group_id: number; enable?: boolean }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const on = enable ?? true;
    const selfInfo= endpoint.pickMember(group_id,endpoint.uin);
    if(!selfInfo.is_admin && !selfInfo.is_owner) return { success: false, message: '我不是群主或管理员，无法开启或关闭匿名聊天' };
    await endpoint.setGroupAnonymous(group_id, on);
    return { success: true, message: on ? '已开启匿名聊天' : '已关闭匿名聊天' };
  },
});
