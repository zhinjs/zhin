import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ chat_id: string; message_id: string }>({
  description: '置顶 Telegram 群组消息',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
    message_id: z.string().describe('消息 ID'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  permissions: [platformPermit('pin_messages')],
  async execute({ chat_id, message_id  }: { chat_id: string; message_id: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.pinMessage(Number(chat_id), Number(message_id));
    return { success, message: success ? '消息已置顶' : '操作失败' };
  },
});
