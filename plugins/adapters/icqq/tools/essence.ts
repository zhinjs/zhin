import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; message_id: string; action: 'add' | 'remove' }>({
  description: '设置或移除 QQ 群精华消息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    message_id: z.string().describe('消息 ID'),
    action: z.enum(['add', 'remove']).describe('add=设为精华, remove=移除精华'),
  }),
  platforms: ['icqq'],
  approval: 'always',
  async execute({ endpoint_id, message_id, action }: { endpoint_id: string; message_id: string; action: 'add' | 'remove' }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    if (action === 'add') {
      await endpoint.setEssenceMessage(message_id);
    } else {
      await endpoint.removeEssenceMessage(message_id);
    }
    return { success: true, message: action === 'add' ? '已设为精华' : '已移除精华' };
  },
});
