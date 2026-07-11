import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineTool<{ endpoint_id: string; chat_id: string; question: string; options: string; is_anonymous?: boolean; allows_multiple?: boolean }>({
  description: '在 Telegram 群组中发起投票',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
    question: z.string().describe('投票问题'),
    options: z.string().describe('选项 JSON 数组，如 ["A","B","C"]'),
    is_anonymous: z.boolean().optional().describe('是否匿名投票，默认 true'),
    allows_multiple: z.boolean().optional().describe('是否允许多选，默认 false'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  async execute({ endpoint_id, chat_id, question, options, is_anonymous, allows_multiple  }: { endpoint_id: string; chat_id: string; question: string; options: string; is_anonymous?: boolean; allows_multiple?: boolean }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    let optList: string[];
    try {
      optList = JSON.parse(options);
    } catch {
      return { success: false, message: 'options 格式错误，应为 JSON 数组' };
    }
    if (!Array.isArray(optList) || optList.length < 2) {
      return { success: false, message: '至少需要 2 个选项' };
    }
    const result = await endpoint.sendPoll(
      Number(chat_id), question, optList,
      is_anonymous ?? true, allows_multiple ?? false,
    );
    return { success: true, message_id: result.message_id, message: '投票已发送' };
  },
});
