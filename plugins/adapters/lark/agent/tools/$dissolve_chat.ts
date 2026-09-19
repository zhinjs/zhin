import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
export default defineAgentTool<{ chat_id: string }>({
  description: '解散飞书群聊（需要群主权限）',
  inputSchema: z.object({
    chat_id: z.string().describe('群聊 ID'),
  }),
  adapter: 'lark',
  tags: ['lark'],
  async execute({ chat_id   }: { chat_id: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.dissolveChat(chat_id);
    return { success, message: success ? '群聊已解散' : '解散失败' };
  },
});

