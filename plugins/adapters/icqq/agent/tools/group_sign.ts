import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineTool<{ endpoint_id: string; group_id: number }>({
  description: 'QQ 群签到打卡',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  async execute({ endpoint_id, group_id    }: { endpoint_id: string; group_id: number }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const resp = await endpoint.ipc.request(Actions.GROUP_SIGN, { group_id });
    return { success: resp.ok, message: resp.ok ? '群签到成功' : (resp.error ?? '签到失败') };
  },
});

