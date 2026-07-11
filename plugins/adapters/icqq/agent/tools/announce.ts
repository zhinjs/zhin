import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineTool<{ endpoint_id: string; group_id: number; content: string }>({
  description: '发送 QQ 群公告（需要管理员权限）',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    content: z.string().describe('公告内容'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  permissions: ['platform(icqq,scene_admin)'],
  async execute({ endpoint_id, group_id, content    }: { endpoint_id: string; group_id: number; content: string }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const resp = await endpoint.ipc.request(Actions.GROUP_ANNOUNCE, { group_id, content });
    return { success: resp.ok, message: resp.ok ? '群公告已发送' : (resp.error ?? '发送失败') };
  },
});

