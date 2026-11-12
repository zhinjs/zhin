import { currentTarget, requireMessageInConversation } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ messages: string }>({
  description: '在当前会话发送合并转发消息。messages 为转发节点数组；引用已有消息的节点（data.id）只能引用当前会话的消息。',
  inputSchema: z.object({
    messages: z.string().describe('转发节点 JSON（node 数组）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['合并转发', 'forward', '转发消息'],
  async execute({ messages }, context) {
    const target = currentTarget(context);
    const nodes: unknown = typeof messages === 'string' ? JSON.parse(messages) : messages;
    if (!Array.isArray(nodes)) throw new Error('messages must be a JSON array of forward nodes');
    for (const node of nodes) {
      const id = (node as { data?: { id?: unknown } } | null)?.data?.id;
      if (id !== undefined && id !== null && id !== '') await requireMessageInConversation(context, Number(id));
    }
    return context.$client.sendForwardMsg(target.type, target.id, nodes);
  },
});
