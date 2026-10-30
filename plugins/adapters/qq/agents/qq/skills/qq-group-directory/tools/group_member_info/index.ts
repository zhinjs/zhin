import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup } from '../../../../conversation.js';

export default defineAgentTool({
  description: '获取当前 QQ 群中指定成员的信息（昵称、角色、是否机器人、入群时间）；官方白名单能力',
  adapter: 'qq',
  scopes: ['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'never',
  readOnly: true,
  inputSchema: z.object({
    user_id: z.string().min(1).describe('目标成员的 member_openid（来自消息发送者或成员列表，不要猜测）'),
  }),
  async execute({ user_id }, context) {
    const member = await context.$client.api.groupService.getMemberInfo(currentGroup(context), user_id);
    return { success: true, member };
  },
});
