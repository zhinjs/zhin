import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ user_id: number; message_seq?: number; count?: number }>({
  description: '获取私聊消息历史记录。',
  inputSchema: z.object({
    user_id: z.number().describe('QQ 号'),
    message_seq: z.number().optional().describe('起始消息序号（可选）'),
    count: z.number().optional().describe('获取条数（可选）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['私聊记录', '好友聊天记录', 'friend history'],
  async execute({ user_id, message_seq, count }: { user_id: number; message_seq?: number; count?: number }, context) {
    const endpoint = context.$client;
      return endpoint.getFriendMsgHistory(user_id, message_seq, count);
  },
});
