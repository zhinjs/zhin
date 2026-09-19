import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ chat_id: string; sticker: string }>({
  description: '发送 Telegram 贴纸',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
    sticker: z.string().describe('贴纸 file_id 或 URL'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ chat_id, sticker  }: { chat_id: string; sticker: string }, context) {
    const endpoint = context.$client;
    const result = await endpoint.sendStickerMessage(Number(chat_id), sticker);
    return { success: true, message_id: result.message_id, message: '贴纸已发送' };
  },
});
