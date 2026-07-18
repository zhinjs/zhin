import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number }>({
  description: '查询 QQ 群中当前被禁言的成员列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  permissions: ['platform(icqq,scene_admin)'],
  async execute({ endpoint_id, group_id    }: { endpoint_id: string; group_id: number }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const resp = await endpoint.ipc.request(Actions.GROUP_MUTED_LIST, { group_id });
    if (!resp.ok) throw new Error(resp.error ?? '获取禁言列表失败');
    const list = Array.isArray(resp.data) ? resp.data : [];
    return { muted_members: list, count: list.length };
  },
});

