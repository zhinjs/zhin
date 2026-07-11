import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineTool<{ endpoint_id: string; chat_id: string }>({
  description: '获取 Telegram 群组管理员列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  async execute({ endpoint_id, chat_id  }: { endpoint_id: string; chat_id: string }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    const admins = await endpoint.getChatAdmins(Number(chat_id));
    return {
      admins: admins.map((a: { user: { id: number; username?: string; first_name?: string }; status: string }) => ({
        user_id: a.user.id,
        username: a.user.username,
        first_name: a.user.first_name,
        status: a.status,
      })),
      count: admins.length,
    };
  },
});
