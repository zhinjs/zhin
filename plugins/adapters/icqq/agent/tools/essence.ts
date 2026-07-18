import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; message_id: string; action: 'add' | 'remove' }>({
  description: '设置或移除 QQ 群精华消息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    message_id: z.string().describe('消息 ID'),
    action: z.enum(['add', 'remove']).describe('add=设为精华, remove=移除精华'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  permissions: ['platform(icqq,scene_admin)'],
  async execute({ endpoint_id, message_id, action }: { endpoint_id: string; message_id: string; action: 'add' | 'remove' }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const act = action === 'add' ? Actions.GROUP_ESSENCE_ADD : Actions.GROUP_ESSENCE_REMOVE;
    const resp = await endpoint.ipc.request(act, { message_id });
    return { success: resp.ok, message: resp.ok ? (action === 'add' ? '已设为精华' : '已移除精华') : (resp.error ?? '操作失败') };
  },
});

