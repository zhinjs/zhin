import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineTool<{ endpoint_id: string; group_id: number; enable?: boolean }>({
  description: '开启或关闭 QQ 群的匿名聊天功能',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    enable: z.boolean().optional().describe('true=开启，false=关闭，默认 true'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  permissions: ['platform(icqq,scene_owner)'],
  async execute({ endpoint_id, group_id, enable    }: { endpoint_id: string; group_id: number; enable?: boolean }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const on = enable ?? true;
    const resp = await endpoint.ipc.request(Actions.GROUP_ALLOW_ANONY, { group_id, enable: on });
    return { success: resp.ok, message: resp.ok ? (on ? '已开启匿名聊天' : '已关闭匿名聊天') : (resp.error ?? '操作失败') };
  },
});

