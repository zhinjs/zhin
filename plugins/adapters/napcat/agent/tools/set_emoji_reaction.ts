import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ message_id: number; emoji_id: string }>({
  description: '为消息添加表情回应（贴表情）。',
  inputSchema: z.object({
    message_id: z.number().describe('消息 ID'),
    emoji_id: z.string().describe('表情 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['表情回应', 'reaction', '贴表情', 'emoji'],
  async execute({ message_id, emoji_id }: { message_id: number; emoji_id: string }, context) {
    const endpoint = context.$client;
      await endpoint.setMsgEmojiLike(message_id, emoji_id);
      return { success: true };
  },
});
