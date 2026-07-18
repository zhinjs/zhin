import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{
  endpoint_id: string;
  message_type: 'private' | 'group';
  id: number;
  messages: string;
}>({
  description: '发送合并转发消息（群聊或私聊）。messages 为转发节点数组。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    message_type: z.enum(['private', 'group']).describe('private 或 group'),
    id: z.number().describe('群号或 QQ 号'),
    messages: z.string().describe('转发节点 JSON（node 数组）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['合并转发', 'forward', '转发消息'],
  async execute({ endpoint_id, message_type, id, messages }: {
    endpoint_id: string;
    message_type: 'private' | 'group';
    id: number;
    messages: string;
  }) {
    const endpoint = getEndpoint(endpoint_id);
    const nodes = typeof messages === 'string' ? JSON.parse(messages) : messages;
    return endpoint.sendForwardMsg(message_type, id, nodes);
  },
});
