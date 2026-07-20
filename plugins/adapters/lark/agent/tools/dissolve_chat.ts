import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLarkAgentDeps } from '../../src/lark-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; chat_id: string }>({
  description: '解散飞书群聊（需要群主权限）',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('群聊 ID'),
  }),
  platforms: ['lark'],
  tags: ['lark'],
  async execute({ endpoint_id, chat_id   }: { endpoint_id: string; chat_id: string }) {
    const endpoint = getLarkAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.dissolveChat(chat_id);
    return { success, message: success ? '群聊已解散' : '解散失败' };
  },
});

