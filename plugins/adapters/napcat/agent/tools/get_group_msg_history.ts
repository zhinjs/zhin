import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; group_id: number; message_seq?: number; count?: number }>({
  description: '获取群消息历史记录。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
    message_seq: z.number().optional().describe('起始消息序号（可选，不传从最新开始）'),
    count: z.number().optional().describe('获取条数（可选）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['群消息历史', '聊天记录', 'message history'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id, message_seq, count }: { endpoint_id: string; group_id: number; message_seq?: number; count?: number }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.getGroupMsgHistory(group_id, message_seq, count);
  },
});
