import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message_seq?: number; count?: number }>({
  description: '获取当前群的消息历史记录。',
  inputSchema: z.object({
    message_seq: z.number().optional().describe('起始消息序号（可选，不传从最新开始）'),
    count: z.number().optional().describe('获取条数（可选）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群消息历史', '聊天记录', 'message history'],
  scopes: ['group'],
  async execute({ message_seq, count }, context) {
    return context.$client.getGroupMsgHistory(currentGroup(context), message_seq, count);
  },
});
