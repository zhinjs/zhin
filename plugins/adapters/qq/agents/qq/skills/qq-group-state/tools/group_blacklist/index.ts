import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup } from '../../../../conversation.js';

export default defineAgentTool({
  description: '分页查询当前 QQ 群的成员黑名单；官方白名单能力',
  adapter: 'qq',
  scopes: ['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'never',
  readOnly: true,
  inputSchema: z.object({
    cursor: z.string().optional().describe('上一页返回的 next_cursor；首次不传'),
  }),
  async execute({ cursor }, context) {
    const page = await context.$client.api.groupService.getMemberBlacklist(currentGroup(context), cursor ? { cursor } : {});
    return { users: page.users ?? [], count: page.users?.length ?? 0, next_cursor: page.next_cursor || undefined };
  },
});
