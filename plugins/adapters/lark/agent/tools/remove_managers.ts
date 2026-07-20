import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLarkAgentDeps } from '../../src/lark-agent-deps.js';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ endpoint_id: string; chat_id: string; user_ids: string }>({
  description: '移除飞书群管理员',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('群聊 ID'),
    user_ids: z.string().describe('用户 open_id 列表，逗号分隔'),
  }),
  platforms: ['lark'],
  tags: ['lark'],
  permissions: [platformPermit('manage_managers')],
  async execute({ endpoint_id, chat_id, user_ids   }: { endpoint_id: string; chat_id: string; user_ids: string }) {
    const endpoint = getLarkAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.removeChatManagers(chat_id, user_ids.split(','));
    return { success, message: success ? '管理员移除成功' : '移除失败' };
  },
});

