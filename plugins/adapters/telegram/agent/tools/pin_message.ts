import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineTool<{ endpoint_id: string; chat_id: string; message_id: string }>({
  description: '置顶 Telegram 群组消息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
    message_id: z.string().describe('消息 ID'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  permissions: [platformPermit('pin_messages')],
  async execute({ endpoint_id, chat_id, message_id  }: { endpoint_id: string; chat_id: string; message_id: string }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.pinMessage(Number(chat_id), Number(message_id));
    return { success, message: success ? '消息已置顶' : '操作失败' };
  },
});
