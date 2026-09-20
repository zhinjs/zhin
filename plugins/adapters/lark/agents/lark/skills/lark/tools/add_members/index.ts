import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{ chat_id: string; user_ids: string }>({
  description: '添加飞书群成员',
  inputSchema: z.object({
    chat_id: z.string().describe('群聊 ID'),
    user_ids: z.string().describe('用户 open_id 列表，逗号分隔'),
  }),
  adapter: 'lark',
  tags: ['lark'],
  permissions: [platformPermission('lark', 'chat_admin')],
  async execute({ chat_id, user_ids   }: { chat_id: string; user_ids: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.addChatMembers(chat_id, user_ids.split(','));
    return { success, message: success ? '成员添加成功' : '添加失败' };
  },
});
