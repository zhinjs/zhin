import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; chat_id: string; description: string }>({
  description: '设置 Telegram 群组描述',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
    description: z.string().describe('群描述文字'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  async execute({ endpoint_id, chat_id, description  }: { endpoint_id: string; chat_id: string; description: string }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.setChatDescription(Number(chat_id), description);
    return { success, message: success ? '群描述已更新' : '操作失败' };
  },
});
