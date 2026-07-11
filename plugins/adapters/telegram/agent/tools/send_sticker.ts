import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineTool<{ endpoint_id: string; chat_id: string; sticker: string }>({
  description: '发送 Telegram 贴纸',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
    sticker: z.string().describe('贴纸 file_id 或 URL'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  async execute({ endpoint_id, chat_id, sticker  }: { endpoint_id: string; chat_id: string; sticker: string }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    const result = await endpoint.sendStickerMessage(Number(chat_id), sticker);
    return { success: true, message_id: result.message_id, message: '贴纸已发送' };
  },
});
