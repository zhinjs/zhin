import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
export default defineAgentTool<{ name: string; members: string; owner?: string }>({
  description: '创建飞书群聊',
  inputSchema: z.object({
    name: z.string().describe('群名'),
    members: z.string().describe('成员 open_id 列表，逗号分隔'),
    owner: z.string().optional().describe('群主 open_id（可选）'),
  }),
  adapter: 'lark',
  tags: ['lark'],
  async execute({ name, members, owner   }: { name: string; members: string; owner?: string }, context) {
    const endpoint = context.$client;
    const chatId = await endpoint.createChat(name, members.split(','), owner);
    return { success: !!chatId, chat_id: chatId, message: chatId ? `群聊创建成功: ${chatId}` : '创建失败' };
  },
});

