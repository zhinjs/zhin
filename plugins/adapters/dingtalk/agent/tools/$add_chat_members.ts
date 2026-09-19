import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ chat_id: string; user_ids: string }>({
  description: '向钉钉群聊添加成员',
  inputSchema: z.object({
    chat_id: z.string().describe('群聊 ID'),
    user_ids: z.string().describe('要添加的用户 ID 列表，逗号分隔'),
  }),
  adapter: 'dingtalk',
  tags: ['dingtalk'],
  permissions: [platformPermit('chat_admin')],
  async execute({ chat_id, user_ids    }: { chat_id: string; user_ids: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.updateChat(chat_id, { add_useridlist: user_ids.split(',') });
    return { success, message: success ? '成员添加成功' : '添加失败' };
  },
});

