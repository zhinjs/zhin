import { messages as t } from "../../../../messages.js";
import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ content: string }>({
  description: '在当前 QQ 群发送群公告（需要管理员权限）',
  inputSchema: z.object({
    content: z.string().describe('公告内容'),
  }),
  adapter: 'icqq',
  // ADR 0044: offered only while the Bot can actually do this here (e.g. it is a group admin).
  requiresCapabilities: ['actions.announce'],
  requiresApproval: 'once',
  scopes:['group'],
  // Platform permits are judged in the current conversation, so the target is the current group only.
  permissions: ['platform:admin', 'bot:admin'],
  async execute({ content }, context) {
    await context.$client.sendGroupNotice(currentGroup(context), content);
    return { success: true, message: t(context.locale, 'announcementSent') };
  },
});
