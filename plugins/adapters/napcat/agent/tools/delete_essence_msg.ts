import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; message_id: number }>({
  description: '移除群精华消息。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    message_id: z.number().describe('消息 ID'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['取消精华', '移除精华', 'delete essence'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ endpoint_id, message_id }: { endpoint_id: string; message_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.deleteEssenceMsg(message_id);
      return { success: true };
  },
});
