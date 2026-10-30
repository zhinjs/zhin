import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup } from '../../../../conversation.js';

export default defineAgentTool({
  description: '分页列出当前 QQ 群成员（每页最多 30 人，含 member_openid、昵称、角色）；官方白名单能力',
  adapter: 'qq',
  scopes: ['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'never',
  readOnly: true,
  inputSchema: z.object({
    cursor: z.string().optional().describe('上一页返回的 next_cursor；首次不传'),
  }),
  async execute({ cursor }, context) {
    const page = await context.$client.api.groupService.getMembersPage(currentGroup(context), cursor ? { cursor } : {});
    return { success: true, members: page.members ?? [], count: page.members?.length ?? 0, next_cursor: page.next_cursor || undefined };
  },
});
