import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; chat_id: string }>({
  description: '创建 Telegram 群组邀请链接',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  permissions: [platformPermit('chat_administrator')],
  async execute({ endpoint_id, chat_id  }: { endpoint_id: string; chat_id: string }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    const link = await endpoint.createInviteLink(Number(chat_id));
    return { invite_link: link, message: `邀请链接: ${link}` };
  },
});
