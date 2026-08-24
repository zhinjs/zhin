import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number; message_seq?: number; count?: number }>({
  description: '获取群消息历史记录。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
    message_seq: z.number().optional().describe('起始消息序号（可选，不传从最新开始）'),
    count: z.number().optional().describe('获取条数（可选）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群消息历史', '聊天记录', 'message history'],
  scopes: ['group'],
  async execute({ group_id, message_seq, count }: { group_id: number; message_seq?: number; count?: number }, context) {
    const endpoint = context.$client;
      return endpoint.getGroupMsgHistory(group_id, message_seq, count);
  },
});
