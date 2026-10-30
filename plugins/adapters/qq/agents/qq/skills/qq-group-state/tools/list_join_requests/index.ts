import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup } from '../../../../conversation.js';

export default defineAgentTool({
  description: '分页列出当前 QQ 群待处理的入群申请（含验证信息、风险提示）；官方白名单能力',
  adapter: 'qq',
  scopes: ['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'never',
  readOnly: true,
  inputSchema: z.object({
    cursor: z.string().optional().describe('上一页返回的 next_cursor；首次不传'),
  }),
  async execute({ cursor }, context) {
    const page = await context.$client.groupService.getJoinRequests(currentGroup(context), cursor ? { cursor } : {});
    return { requests: page.list ?? [], count: page.list?.length ?? 0, next_cursor: page.next_cursor || undefined };
  },
});
