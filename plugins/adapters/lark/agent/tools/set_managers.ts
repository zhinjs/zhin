import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLarkAgentDeps } from '../../src/lark-agent-deps.js';
import { platformPermit } from '../../src/platform-permit.js';

export default defineTool<{ endpoint_id: string; chat_id: string; user_ids: string }>({
  description: '设置飞书群管理员',
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
    const success = await endpoint.setChatManagers(chat_id, user_ids.split(','));
    return { success, message: success ? '管理员设置成功' : '设置失败' };
  },
});

