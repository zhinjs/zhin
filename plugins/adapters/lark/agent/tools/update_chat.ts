import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLarkAgentDeps } from '../../src/lark-agent-deps.js';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ endpoint_id: string; chat_id: string; name?: string; description?: string }>({
  description: '更新飞书群聊信息（群名、描述）',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('群聊 ID'),
    name: z.string().optional().describe('新群名（可选）'),
    description: z.string().optional().describe('新描述（可选）'),
  }),
  platforms: ['lark'],
  tags: ['lark'],
  permissions: [platformPermit('chat_admin')],
  async execute({ endpoint_id, chat_id, name, description   }: { endpoint_id: string; chat_id: string; name?: string; description?: string }) {
    const endpoint = getLarkAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.updateChatInfo(chat_id, { name, description });
    return { success, message: success ? '群信息更新成功' : '更新失败' };
  },
});

