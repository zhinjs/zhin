import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number }>({
  description: '查询 QQ 群中当前被禁言的成员列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
  }),
  platforms: ['icqq'],
  permissions: ['role(master,admin)'],
  async execute({ endpoint_id, group_id }: { endpoint_id: string; group_id: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const members = await endpoint.getGroupMemberList(group_id);
    const now = Math.floor(Date.now() / 1000);
    const muted = Array.from(members.values()).filter((m) => m.shutup_time > now);
    return { muted_members: muted, count: muted.length };
  },
});
