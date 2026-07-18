import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; chat_id: string }>({
  description: '获取 Telegram 群组成员数量',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  async execute({ endpoint_id, chat_id  }: { endpoint_id: string; chat_id: string }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    const count = await endpoint.getChatMemberCount(Number(chat_id));
    return { count, message: `群组共有 ${count} 名成员` };
  },
});
