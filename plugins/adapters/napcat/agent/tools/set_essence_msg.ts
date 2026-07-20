import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; message_id: number }>({
  description: '设置群精华消息。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    message_id: z.number().describe('消息 ID'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['精华', 'essence', '设精', '加精'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ endpoint_id, message_id }: { endpoint_id: string; message_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.setEssenceMsg(message_id);
      return { success: true };
  },
});
