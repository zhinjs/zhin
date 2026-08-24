import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{
  target_type: 'friend' | 'group';
  target_id: number;
  message_id: number;
}>({
  description: '转发单条消息到指定好友或群。',
  inputSchema: z.object({
    target_type: z.enum(['friend', 'group']).describe('friend 或 group'),
    target_id: z.number().describe('目标好友 QQ 号或群号'),
    message_id: z.number().describe('要转发的消息 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['转发', 'forward', '单条转发'],
  async execute({ target_type, target_id, message_id }: {
    target_type: 'friend' | 'group';
    target_id: number;
    message_id: number;
  }, context) {
    const endpoint = context.$client;
    if (target_type === 'friend') await endpoint.forwardFriendSingleMsg(target_id, message_id);
    else await endpoint.forwardGroupSingleMsg(target_id, message_id);
    return { success: true };
  },
});
