import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; message_id: number; emoji_id: string }>({
  description: '为消息添加表情回应（贴表情）。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    message_id: z.number().describe('消息 ID'),
    emoji_id: z.string().describe('表情 ID'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['表情回应', 'reaction', '贴表情', 'emoji'],
  async execute({ endpoint_id, message_id, emoji_id }: { endpoint_id: string; message_id: number; emoji_id: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.setMsgEmojiLike(message_id, emoji_id);
      return { success: true };
  },
});
