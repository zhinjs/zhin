import { messages as t } from "../../../../messages.js";
import { sendToCurrentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ sticker: string }>({
  description: '在当前 Telegram 会话发送贴纸',
  inputSchema: z.object({
    sticker: z.string().describe('贴纸 file_id 或 http(s) URL'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ sticker }, context) {
    // `telegram:sticker` is the Telegram adapter's namespaced outbound segment.
    const result = await sendToCurrentChat(context, { type: 'telegram:sticker', data: { sticker } });
    return { ...result, message: t(context.locale, result.success ? 'stickerSent' : 'operationFailed') };
  },
});
