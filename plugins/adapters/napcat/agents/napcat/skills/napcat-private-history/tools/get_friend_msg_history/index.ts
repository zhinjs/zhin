import { currentPrivatePeer } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message_seq?: number; count?: number }>({
  description: '获取当前私聊的消息历史记录。',
  inputSchema: z.object({
    message_seq: z.number().optional().describe('起始消息序号（可选）'),
    count: z.number().optional().describe('获取条数（可选）'),
  }),
  adapter: 'napcat',
  scopes: ["private"],
  tags: ['napcat', 'qq'],
  keywords: ['私聊记录', '好友聊天记录', 'friend history'],
  async execute({ message_seq, count }, context) {
    return context.$client.getFriendMsgHistory(currentPrivatePeer(context), message_seq, count);
  },
});
