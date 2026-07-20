import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; user_id: number }>({
  description: '邀请好友加入 QQ 群',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要邀请的 QQ号'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  async execute({ endpoint_id, group_id, user_id    }: { endpoint_id: string; group_id: number; user_id: number }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const resp = await endpoint.ipc.request(Actions.GROUP_INVITE, { group_id, user_id });
    return { success: resp.ok, message: resp.ok ? `已邀请 ${user_id} 加入群` : (resp.error ?? '邀请失败') };
  },
});

