import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ chat_id: string; user_ids: string }>({
  description: '移除飞书群管理员',
  inputSchema: z.object({
    chat_id: z.string().describe('群聊 ID'),
    user_ids: z.string().describe('用户 open_id 列表，逗号分隔'),
  }),
  adapter: 'lark',
  tags: ['lark'],
  permissions: [platformPermit('manage_managers')],
  async execute({ chat_id, user_ids   }: { chat_id: string; user_ids: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.removeChatManagers(chat_id, user_ids.split(','));
    return { success, message: success ? '管理员移除成功' : '移除失败' };
  },
});

