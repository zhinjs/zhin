import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ message_id: string; action: 'add' | 'remove' }>({
  description: '设置或移除 QQ 群精华消息',
  inputSchema: z.object({
    message_id: z.string().describe('消息 ID，或消息头里的 m<n> 别名'),
    action: z.enum(['add', 'remove']).describe('add=设为精华, remove=移除精华'),
  }),
  adapter: 'icqq',
  // ADR 0044: offered only while the Bot can actually do this here (e.g. it is a group admin).
  requiresCapabilities: ['actions.essence'],
  requiresApproval: 'once',
  scopes:['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  async execute({ message_id, action }, context) {
    const client = context.$client;
    if (action === 'add') {
      await client.setEssenceMessage(message_id);
    } else {
      await client.removeEssenceMessage(message_id);
    }
    return { success: true, message: action === 'add' ? t(context.locale, 'essenceAdded') : t(context.locale, 'essenceRemoved') };
  },
});
