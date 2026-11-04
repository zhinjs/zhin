import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; content: string }>({
  description: '发送 QQ 群公告（需要管理员权限）',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    content: z.string().describe('公告内容'),
  }),
  adapter: 'icqq',
  // ADR 0044: offered only while the Bot can actually do this here (e.g. it is a group admin).
  requiresCapabilities: ['actions.announce'],
  requiresApproval: 'once',
  scopes:['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  async execute({ group_id, content }, context) {
    await context.$client.sendGroupNotice(group_id, content);
    return { success: true, message: t(context.locale, 'announcementSent') };
  },
});
