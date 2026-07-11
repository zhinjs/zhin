import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineTool<{ endpoint_id: string; chat_id: string; message_id: string; reaction: string }>({
  description: '对 Telegram 消息添加表情反应',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
    message_id: z.string().describe('消息 ID'),
    reaction: z.string().describe('反应表情（如 👍、❤️、🔥）'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  async execute({ endpoint_id, chat_id, message_id, reaction  }: { endpoint_id: string; chat_id: string; message_id: string; reaction: string }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.setMessageReaction(Number(chat_id), Number(message_id), reaction);
    return { success, message: success ? `已添加反应 ${reaction}` : '操作失败' };
  },
});
