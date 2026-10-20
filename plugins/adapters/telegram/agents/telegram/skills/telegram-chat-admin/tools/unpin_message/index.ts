import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{ chat_id: string; message_id?: string }>({
  description: '取消置顶 Telegram 群组消息',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
    message_id: z.string().optional().describe('消息 ID（可选，不提供则取消所有置顶）'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  permissions: [platformPermission('telegram', 'pin_messages')],
  async execute({ chat_id, message_id  }: { chat_id: string; message_id?: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.unpinMessage(Number(chat_id), message_id ? Number(message_id) : undefined);
    return { success, message: success ? '已取消置顶' : '操作失败' };
  },
});
