import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; target_id: number; message_id: number }>({
  description: '转发单条消息到指定好友或群。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    target_type: z.enum(['friend', 'group']).describe('friend 或 group'),
    target_id: z.number().describe('目标好友 QQ 号或群号'),
    message_id: z.number().describe('要转发的消息 ID'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['转发', 'forward', '单条转发'],
  async execute({ endpoint_id, target_id, message_id }: { endpoint_id: string; target_id: number; message_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      if (input.target_type === 'friend') await endpoint.forwardFriendSingleMsg(target_id, message_id);
      else await endpoint.forwardGroupSingleMsg(target_id, message_id);
      return { success: true };
  },
});
