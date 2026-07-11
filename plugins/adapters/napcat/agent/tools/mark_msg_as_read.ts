import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; message_id: number }>({
  description: '标记消息为已读。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    message_id: z.number().describe('消息 ID'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['已读', 'mark read', '标记已读'],
  async execute({ endpoint_id, message_id }: { endpoint_id: string; message_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.markMsgAsRead(message_id);
      return { success: true };
  },
});
