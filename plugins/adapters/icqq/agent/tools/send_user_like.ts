import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineTool<{ endpoint_id: string; user_id: number; times?: number }>({
  description: '给用户点赞（竖大拇指），每人每天最多 20 次',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    user_id: z.number().describe('要点赞的目标用户 QQ号'),
    times: z.number().optional().describe('点赞次数（1-20），默认 1'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  async execute({ endpoint_id, user_id, times    }: { endpoint_id: string; user_id: number; times?: number }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const resp = await endpoint.ipc.request(Actions.FRIEND_LIKE, {
      user_id, times: Math.min(times ?? 1, 20),
    });
    return { success: resp.ok, message: resp.ok ? `已给 ${user_id} 点赞` : (resp.error ?? '点赞失败') };
  },
});

