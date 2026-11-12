import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ sticker: string }>({
  description: '在当前 Telegram 会话发送贴纸',
  inputSchema: z.object({
    sticker: z.string().describe('贴纸 file_id 或 URL'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ sticker }, context) {
    const result = await context.$client.sendStickerMessage(currentChat(context, { allowPrivate: true }), sticker);
    return { success: true, message_id: result.message_id, message: t(context.locale, 'stickerSent') };
  },
});
