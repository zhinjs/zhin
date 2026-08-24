import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{
  message_type: 'private' | 'group';
  id: number;
  messages: string;
}>({
  description: '发送合并转发消息（群聊或私聊）。messages 为转发节点数组。',
  inputSchema: z.object({
    message_type: z.enum(['private', 'group']).describe('private 或 group'),
    id: z.number().describe('群号或 QQ 号'),
    messages: z.string().describe('转发节点 JSON（node 数组）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['合并转发', 'forward', '转发消息'],
  async execute({ message_type, id, messages }: {
    message_type: 'private' | 'group';
    id: number;
    messages: string;
  }, context) {
    const endpoint = context.$client;
    const nodes = typeof messages === 'string' ? JSON.parse(messages) : messages;
    return endpoint.sendForwardMsg(message_type, id, nodes);
  },
});
