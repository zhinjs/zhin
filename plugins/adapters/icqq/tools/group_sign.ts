import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number }>({
  description: 'QQ 群签到/打卡',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
  }),
  platforms: ['icqq'],
  approval: 'never',
  async execute({ endpoint_id, group_id }: { endpoint_id: string; group_id: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const groupInfo= endpoint.pickGroup(group_id);
    if(!groupInfo) return { success: false, message: '目标群不存在' };
    await endpoint.sendGroupSign(group_id);
    return { success: true, message: '群签到成功' };
  },
});
