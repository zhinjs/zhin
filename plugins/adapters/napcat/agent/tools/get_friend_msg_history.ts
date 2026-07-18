import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; user_id: number; message_seq?: number; count?: number }>({
  description: '获取私聊消息历史记录。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.number().describe('QQ 号'),
    message_seq: z.number().optional().describe('起始消息序号（可选）'),
    count: z.number().optional().describe('获取条数（可选）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['私聊记录', '好友聊天记录', 'friend history'],
  async execute({ endpoint_id, user_id, message_seq, count }: { endpoint_id: string; user_id: number; message_seq?: number; count?: number }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.getFriendMsgHistory(user_id, message_seq, count);
  },
});
