import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLarkAgentDeps } from '../../src/lark-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; name: string; members: string; owner?: string }>({
  description: '创建飞书群聊',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    name: z.string().describe('群名'),
    members: z.string().describe('成员 open_id 列表，逗号分隔'),
    owner: z.string().optional().describe('群主 open_id（可选）'),
  }),
  platforms: ['lark'],
  tags: ['lark'],
  async execute({ endpoint_id, name, members, owner   }: { endpoint_id: string; name: string; members: string; owner?: string }) {
    const endpoint = getLarkAgentDeps().getEndpoint(endpoint_id);
    const chatId = await endpoint.createChat(name, members.split(','), owner);
    return { success: !!chatId, chat_id: chatId, message: chatId ? `群聊创建成功: ${chatId}` : '创建失败' };
  },
});

